'use strict';

const Buffer = require('buffer').Buffer;
const lz4 = require('lz4');
import { defaultTypesNames } from './defaulTypesNames.js';
const typeNameStrings = new Map(defaultTypesNames);
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

//const [ filePath ] = process.argv.slice(2);

const INT       = Symbol.for('INT'), //https://subdiox.github.io/deresute/resource/unity3d-string.html
      FLOAT     = Symbol.for('FLOAT'),
      S_INT     = Symbol.for('S_INT'),
      BUFFER    = Symbol.for('BUFFER'),
      TEXT      = Symbol.for('TEXT'),
      TEXT_NULL = Symbol.for('TEXT_NULL'),
      ARRAY     = Symbol.for('ARRAY'),
      SKIP      = Symbol.for('SKIP');

const types = new Map([
    [INT, [
        2147483870, //int
        2147484582, //unsigned int
        2147484595, //unsigned long long
        2147484614, //unsigned short
        2147484576, //UInt8
        2147484555, //UInt16
        2147484562, //UInt32
        2147484569, //UInt64
        2147483724, //bool
    ]],
    [S_INT, [
        2147484469, //SInt8
        2147484448, //SInt16
        2147484455, //SInt32
        2147484462 //SInt64
    ]],
    [FLOAT, [
        2147483809
    ]],
    [TEXT, [
        2147484488
    ]],
    [ARRAY, [
        2147483697
    ]],
    [BUFFER, [
        'm_FontData'
    ]]
]);

function alignTo(source, align) {
    return (align - (source % align)) % align;
}

function concatBuffers(buffers) {
    var totalSize = 0;
    const arrays = buffers.map((buffer) => {
        totalSize = totalSize + buffer.byteLength;
        
        return new Uint8Array(buffer);
    });

    const concatted = new Uint8Array(totalSize);
    var offset = 0;
    for (const array of arrays) {
        concatted.set(array, offset);
        offset = offset + array.length;
    }

    return concatted.buffer;
}

const byteWalker = {
    init: function(offset = 0) {
        this.offset = offset;
    },

    walk: function(byteCount) {
        const newOffset = this.offset + byteCount;
        this.offset = newOffset;
        return newOffset;
    },

    jumpTo: function(offset) {
        this.offset = offset;
        return offset;
    },

    getOffset: function() {
        return this.offset;
    },

    processDataObject: function *(dataObject) {
        for (const object of dataObject) {
            
            yield object;

            this.walk(object.size);
        }
    },

    processDataObjects: function *goRecursively(map) {
        for (let mapOrDataObject of map) {
            if (mapOrDataObject instanceof Array) mapOrDataObject = mapOrDataObject[1]; //fix the monkey patching
            if (mapOrDataObject instanceof Map) {

                yield *this.processDataObjects(mapOrDataObject);

            } else {

                yield *this.processDataObject(mapOrDataObject);

            }
        }
    }
};

const reader = Object.create(byteWalker);
reader.setup = function(dataView, offset) {
    this.init(offset);

    this.view = dataView;

    return this;
};

reader.read = function(mapOrObject) {
    for (const dataObject of this.processDataObjects(mapOrObject)) {
        const currentOffset = this.getOffset();
        dataObject.absoluteOffset = currentOffset;
        const { name, absoluteOffset, size, type, littleEndian } = dataObject;

        switch (type) {
            case INT:
                dataObject.data = this.getInt(size, absoluteOffset, littleEndian);
                break;
            case S_INT:
                dataObject.data = this.getSint(size, absoluteOffset, littleEndian);
                break;
            case FLOAT:
                dataObject.data = this.getFloat(size, absoluteOffset, littleEndian);
                break;
            case BUFFER:
                dataObject.data = this.view.buffer.slice(absoluteOffset, absoluteOffset + size);
                break;
            case TEXT:
                dataObject.data = textDecoder.decode(this.view.buffer.slice(absoluteOffset, absoluteOffset + size));
                break;
            case TEXT_NULL:
                [ dataObject.data, dataObject.size ] = this.getTextNull(absoluteOffset);
                break;
            case SKIP:
                //console.log('skip: ' + size);
        }

        //console.log(name, absoluteOffset, size, type, dataObject.data);
        if (dataObject.getName/* && dataObject.absoluteOffset >= 4045152 && dataObject.absoluteOffset <= 261204 && dataObject.data.startsWith && dataObject.data.startsWith('archive')*/) {
            //console.log(dataObject.absoluteOffset, dataObject.getName(), dataObject.getType(), dataObject.size, dataObject.data);
        } else if (true/* && dataObject.absoluteOffset >= 4045152/* && dataObject.absoluteOffset <= 4162204*/) {
            //console.log(dataObject.absoluteOffset, name, type, dataObject.size, dataObject.data);
        }
    }
};

reader.getInt = function(size, absoluteOffset, littleEndian) {
    switch(size) {
        case 1:
            return this.view.getUint8(absoluteOffset);
        case 2:
            return this.view.getUint16(absoluteOffset, littleEndian);
        case 4:
            return this.view.getUint32(absoluteOffset, littleEndian);
        case 8:
            return this.view.getBigUint64(absoluteOffset, littleEndian);
    }
};

reader.getSint = function(size, absoluteOffset, littleEndian) {
    switch(size) {
        case 1:
            return this.view.getInt8(absoluteOffset);
        case 2:
            return this.view.getInt16(absoluteOffset, littleEndian);
        case 4:
            return this.view.getInt32(absoluteOffset, littleEndian);
        case 8:
            return this.view.getBigInt64(absoluteOffset, littleEndian);
    }
};

reader.getFloat = function(size, absoluteOffset, littleEndian) {
    switch(size) {
        case 4:
            //return this.view.getFloat32(absoluteOffset, littleEndian);
            return this.view.getInt32(absoluteOffset, littleEndian); //store float values as int because not all of them are valid floats, convert if needed
        case 8:
            //return this.view.getFloat64(absoluteOffset, littleEndian);
            return this.view.getInt64(absoluteOffset, littleEndian);
    }
};

reader.getTextNull = function(absoluteOffset) {
    var byte,
        size = 0;

    do {
        byte = this.view.getUint8(absoluteOffset);
        absoluteOffset = absoluteOffset + 1;
        size = size + 1;
    } while (byte != 0x00);
//console.log('null text size: ' + size)
    return [
        textDecoder.decode(this.view.buffer.slice(absoluteOffset - size, absoluteOffset - 1)),
        size - 1
    ];
};

reader.look = function(offset, dataObject) {
    const currentOffset = this.getOffset();
    this.walk(offset);
    this.read(dataObject);
    this.jumpTo(currentOffset);
    return dataObject;
};

reader.lookBack = function(offset, dataObject) {
    return this.look(-offset, dataObject);
};

reader.lookForward = function(offset, dataObject) {
    return this.look(offset, dataObject);
};

const writer = Object.create(byteWalker);
writer.setup = function(dataView, offset) {
    this.init(offset);

    this.view = dataView;

    return this;
};

writer.write = function(mapOrObject) {
    for (const dataObject of this.processDataObjects(mapOrObject)) {
        dataObject.absoluteOffset = this.getOffset();
        let { name, data, absoluteOffset, size, type, littleEndian } = dataObject;

        switch(type) {
            case INT:
                //if (name == 'm_FontSize' || name == 'm_FontRenderingMode' || name == 'm_FontStyle' || name == 'm_CharacterSpacing' || name == 'm_CharacterPadding') data = data + 21;
                this.setInt(data, size, absoluteOffset, littleEndian);
                break;
            case S_INT:
                this.setSint(data, size, absoluteOffset, littleEndian);
                break;
            case FLOAT:
                if (false && name == 'm_FontSize') {
                    data = data + 21;
                    this.view.setFloat32(absoluteOffset, data, littleEndian)
                } else {
                    this.setFloat(data, size, absoluteOffset, littleEndian);

                }

                break;
            case BUFFER:
                this.setBuffer(dataObject);
                break;
            case TEXT:
                    if (name == 'm_Text') console.log(data);

                this.setText(dataObject);
                break;
            case TEXT_NULL:
                this.setTextNull(dataObject);
                break;
            case SKIP:
        }

        if (dataObject.getName/* && dataObject.absoluteOffset >= 4045152/* && dataObject.absoluteOffset <= 261204 && dataObject.data.startsWith && dataObject.data.startsWith('archive')*/) {
            //console.log(dataObject.absoluteOffset, dataObject.getName(), dataObject.getType(), dataObject.size, dataObject.data);
        } else if (true/* && dataObject.absoluteOffset >= 4045152/* && dataObject.absoluteOffset <= 4162204*/) {
            //console.log(dataObject.absoluteOffset, name, type, dataObject.size, dataObject.data);
        }
    }
};

writer.setInt = function(data, size, absoluteOffset, littleEndian) {
    switch(size) {
        case 1:
            return this.view.setUint8(absoluteOffset, data);
        case 2:
            return this.view.setUint16(absoluteOffset, data, littleEndian);
        case 4:
            return this.view.setUint32(absoluteOffset, data, littleEndian);
        case 8:
            return this.view.setBigUint64(absoluteOffset, BigInt(data), littleEndian);
    }
};

writer.setSint = function(data, size, absoluteOffset, littleEndian) {
    switch(size) {
        case 1:
            return this.view.setInt8(absoluteOffset, data);
        case 2:
            return this.view.setInt16(absoluteOffset, data, littleEndian);
        case 4:
            return this.view.setInt32(absoluteOffset, data, littleEndian);
        case 8:
            return this.view.setBigInt64(absoluteOffset, BigInt(data), littleEndian);
    }
};

writer.setFloat = function(data, size, absoluteOffset, littleEndian) {
    switch(size) {
        case 4:
            return this.view.setInt32(absoluteOffset, data, littleEndian);
        case 8:
            return this.view.setBigInt64(absoluteOffset, BigInt(data), littleEndian);
    }
};

writer.setBuffer = function(dataObject) {
    const byteArray = new Uint8Array(dataObject.data);
    for (let byteIndex = 0; byteIndex < byteArray.length; byteIndex = byteIndex + 1) {
        this.view.setUint8(dataObject.absoluteOffset + byteIndex, byteArray[byteIndex]);
    }

    dataObject.size = byteArray.length;
};

writer.setText = function(dataObject) {
    const textArray = textEncoder.encode(dataObject.data);
    for (let byteIndex = 0; byteIndex < textArray.length; byteIndex = byteIndex + 1) {
        this.view.setUint8(dataObject.absoluteOffset + byteIndex, textArray[byteIndex]);
    }

    dataObject.size = textArray.length;
};

writer.setTextNull = function(dataObject) {
    this.setText(dataObject);
};

writer.writeAt = function(offset, dataObject) {
    const currentOffset = this.getOffset();
    this.jumpTo(offset);
    this.write(dataObject);
    this.jumpTo(currentOffset);
    return dataObject;
};

class baseFileMap extends Map {
    getData(pathString) {
        const pathArray = pathString.split('/');
        return pathArray.reduce((parent, mapOrObjectName) => {
            const mapOrObject = parent ? parent.get(mapOrObjectName) : undefined;
            
            if (mapOrObject instanceof Map) {
                return mapOrObject;
            } else if (mapOrObject instanceof Object) {
                return mapOrObject.data;
            } else {
                return undefined;
            }
        }, this);
    }

    getSection(pathString) {
        const pathArray = pathString.split('/');
        return pathArray.reduce((parent, mapOrObjectName) => {
            const mapOrObject = parent ? parent.get(mapOrObjectName) : undefined;
            
            if (mapOrObject instanceof Map) {
                return mapOrObject;
            } else if (mapOrObject instanceof Object) {
                return mapOrObject;
            } else {
                return undefined;
            }
        }, this);
    }
}

class container extends baseFileMap {
    isLittleEndian() { //returns true if little endian
        const isLittleEndian = this.getData('assetsFileHeader/endianness');
        if (isLittleEndian == undefined || isLittleEndian == 1) {
            return false;
        } else {
            return true;
        }
    }

    getBlockCount() {
        return this.getData('bundleBlockListHeader/blockCount');
    }

    getDirCount() {
        return this.getData('bundleDirListHeader/dirCount');
    }

    getTypeTreeEntryCount() {
        return this.getData('typeTreeHeader/entryCount');
    }

    getAssetsFileOffset() {
        return this.get('assetsFileHeader').get('metadataSize').absoluteOffset;
    }

    getAssetsFileSize() {
        return this.getOffset() - this.getAssetsFileOffset();
    }

    getOffset() { //do something with this
        if (this.fileWriter) {
            return this.fileWriter.getOffset();
        } else if (this.fileReader) {
            return this.fileReader.getOffset();
        }
    }
}

class fileSection extends baseFileMap {
    constructor(format, fileData, iterable) {
        super(/*iterable*/);

        this.isInitialized = false;
        this.format = format;
        this.fileData = fileData;
        this.littleEndian = fileData.isLittleEndian();
    }

    *iterate() {
        for (const formatEntry of this.format) {
            //console.log(this.format);

            const initFormatEntry = Array.from(formatEntry);
            initFormatEntry[3] = this.littleEndian;
            const dataObject = dataObjectFactory(initFormatEntry);
            
            yield dataObject;
            
            //this.set(dataObject.name, dataObject);
            this.set(!this.has(dataObject.name) ? dataObject.name : dataObject.name + dataObject.absoluteOffset, dataObject);
        }
    }

    *[Symbol.iterator]() {
        if (this.isInitialized) {

            yield *super[Symbol.iterator]();

        } else {

            yield *this.iterate();

            this.isInitialized = true;
        }
    }
}

class fileSectionList extends fileSection {
    constructor(format, entryCount, entryName, fileData, iterable) {
        super(format, fileData, iterable);

        this.entryCount = entryCount;
        this.entryName = entryName;
    }

    buildSection() {        
        return new fileSection(this.format, this.fileData);
    }

    *iterate() {
        for (let entryIndex = 1; entryIndex <= this.entryCount; entryIndex = entryIndex + 1) {
            const entry = this.buildSection();

            yield *entry; //I think the delegation isn't necessary

            this.set(this.entryName + entryIndex, entry);
        }
    }

    /**[Symbol.iterator]() {
        if (this.isInitialized) {

            yield *super[Symbol.iterator]();

        } else {
            for (let entryIndex = 1; entryIndex <= this.entryCount; entryIndex = entryIndex + 1) { //move the loop to a generator
                const entry = new fileSection(this.format);

                yield *entry;

                this.set(this.entryName + entryIndex, entry);
            }

            this.isInitialized = true;
        }
    }*/
}

class fileSectionTypeTreeEntryList extends fileSectionList {
    buildSection() {
        return new fileSectionTypeTreeEntry(this.format, this.fileData);
    }
}

class fileSectionTypeTreeEntry extends fileSection {
    *iterate() {
        for (const formatEntry of this.format) {
            if (typeof formatEntry[2] == 'symbol') { //if a data object
                //formatEntry.push(this.littleEndian); //into a function
                //console.log(formatEntry);
                const initFormatEntry = Array.from(formatEntry);
                initFormatEntry[3] = this.littleEndian;
                const dataObject = dataObjectFactory(initFormatEntry);
                
                yield dataObject;
                
                this.set(dataObject.name, dataObject);
            } else {
                const [ name, sectionClass, format, ...args ] = formatEntry;
                let section;
                if (sectionClass == fileSectionFieldList) {
                    section = new fileSectionFieldList(format, this); //combine
                } else if (sectionClass == fileSectionStringTable) {
                    section = new fileSectionStringTable(format, this);
                } else {
                    section = new sectionClass(format, ...args, this.fileData);
                }
                
                yield *section; //I think the delegation isn't necessary

                this.set(name, section);
            }
        }
    }

    getStringTableEntry(offset) {
        return this.get('stringTable').strings.get(offset);
    }
}

class fileSectionFieldList extends fileSectionList {
    constructor(format, typeTreeEntry) {
        super(format, typeTreeEntry.getData('fieldCount'), 'field', typeTreeEntry.fileData);

        this.typeTreeEntry = typeTreeEntry;
    }

    *buildAssetsFileFormat() {

        const rootField = yield;
        //console.log(typeNameStrings.get(rootField.getData('typeStringOffset')), rootField.getData('depth'));

        //const root = new assetsFileRoot(rootField.getData('typeStringOffset'), rootField.getData('nameStringOffset'), this.typeTreeEntry);
        //this.assetsFile = root;
        //const potentialParents = [root.format];
        const rootFormat = [rootField.getData('typeStringOffset'), rootField.getData('nameStringOffset'), [], this.typeTreeEntry];
        this.assetsFileFormat = rootFormat;
        const potentialParents = [rootFormat[2]];

        while (true) {

            const field = yield;

            const depth = field.getData('depth'),
                  typeStringOffset = field.getData('typeStringOffset'),
                  nameStringOffset = field.getData('nameStringOffset');

            let type;
            if (field.isArray()) {
                type = ARRAY;
            } else {
                let name;
                if (nameStringOffset < 2147483648) {
                    const fieldCount = this.typeTreeEntry.getData('fieldCount');
                    const nameStringFieldOffset = (fieldCount - field.getData('index') - 1) * 24 + nameStringOffset;
                    const reader = this.typeTreeEntry.fileData.fileReader;

                    name = reader.lookForward(nameStringFieldOffset, dataObjectFactory(['name', 0, TEXT_NULL])).data;
                }
                const typeArray = [...types.entries()].filter((keyValue) => keyValue[1].includes(typeStringOffset)/* || keyValue[1].includes(name)*/); //change to find

                type = typeArray[0] ? typeArray[0][0] : undefined;
                if (typeStringOffset == 2147484629 && name == 'm_FontData') {
                    type = BUFFER;
                }
            }

            let format;
            switch (type) {
                case INT:
                case S_INT:
                case FLOAT:
                    format = [typeStringOffset, nameStringOffset, field.getData('size'), type, undefined, field.isAligned(), this.typeTreeEntry];
                    break;
                case BUFFER:
                case TEXT:

                    const arrayField = yield; //Array

                    format = [typeStringOffset, nameStringOffset, 0, type, undefined, arrayField.isAligned(), this.typeTreeEntry]; //aligness belongs to the array field but the size field is always 4 bytes so it works

                    yield; //skip size
                    yield; //skip data

                    //depth = depth - 2;
                    break;
                case ARRAY:
                    format = [typeStringOffset, nameStringOffset, arrayAssetsFileSection, [], field.isAligned()];
                    potentialParents[depth] = format;

                    yield; //skip size
                    
                    break;
                default:
                    format = [typeStringOffset, nameStringOffset, containerAssetsFileSection, [], field.isAligned()];
                    potentialParents[depth] = format;
            }

            if (depth != 1) {
                potentialParents[depth - 1][3].push(format);
            } else {
                potentialParents[depth - 1].push(format);
            }
        }
    }

    *iterate() {
        const potentialParents = [this];
        const assetsFileGenerator = this.buildAssetsFileFormat();
        assetsFileGenerator.next();
        for (let entryIndex = 1; entryIndex <= this.entryCount; entryIndex = entryIndex + 1) {
            const entry = new fileSectionField(this.format, this.typeTreeEntry);

            yield *entry; //I think the delegation isn't necessary

            const depth = entry.getData('depth');
            potentialParents[depth + 1] = entry;
            potentialParents[depth].set(this.entryName + entryIndex, entry);

            assetsFileGenerator.next(entry);
        }
    }
}

class fileSectionField extends fileSection {
    constructor(format, typeTreeEntry) {
        super(format, typeTreeEntry.fileData);

        this.typeTreeEntry = typeTreeEntry;
    }

    isAligned() {
        return !!(this.getData('flags') & 0x4000);
    }

    isArray() {
        return !!this.getData('isArray');
    }

    getString(offset) {
        const string = this.typeTreeEntry.getStringTableEntry(offset);
        if (string) {
            return string;
        } else {
            return typeNameStrings.get(offset);
        }
    }

    getType() {
        return this.getString(this.getData('typeStringOffset'));
    }

    getName() {
        return this.getString(this.getData('nameStringOffset'));
    }
}

class fileSectionStringTable extends fileSection {
    constructor(format, typeTreeEntry) {
        super(format, typeTreeEntry.fileData);

        this.typeTreeEntry = typeTreeEntry;
        this.strings = new Map();
    }

    *iterate() {
        let offset = 0;
        const tableLength = this.typeTreeEntry.getData('stringTableLen');
        for (const stringFormat of this.format) {
            //console.log('table length: ', tableLength);
            while (offset < tableLength) {
                const string = dataObjectFactory(stringFormat);

                yield string;

                this.set('string' + offset, string);
                this.strings.set(offset, string.data);
                offset = offset + string.size + 1;
            }
        }
    }
}

class fileSectionCondition extends fileSection {
    constructor(format, fileData, conditionFunc, iterable) { //make fileData the third arg
        super(format, fileData, iterable)

        this.conditionFunc = conditionFunc;
    }

    *iterate() {
        if (this.conditionFunc()) {

            yield *super.iterate();

        }
    }
}

class assetsFileSection extends fileSection {
    constructor(typeStringOffset, nameStringOffset, format, isAligned, typeTreeEntry, iterable) {
        super(format, typeTreeEntry.fileData, iterable);

        this.typeTreeEntry = typeTreeEntry;
        this.typeStringOffset = typeStringOffset;
        this.nameStringOffset = nameStringOffset;
        this.isAligned = isAligned;
    }

    *buildSection() {
        for (const formatEntry of this.format) {
            //if (this.getName() == 'm_LocalRotation') console.log(formatEntry.slice(0, -1));
            if (typeof formatEntry[3] == 'symbol') {
                const initFormatEntry = Array.from(formatEntry);
                initFormatEntry[4] = this.littleEndian;
                const dataObject = dataFileObjectFactory(initFormatEntry);

                yield dataObject;

                let name = dataObject.getName();
                if (this.has(name)) {
                    name = name + dataObject.absoluteOffset;
                }
                this.set(name, dataObject);
            } else {
                const [ typeStringOffset, nameStringOffset, sectionClass, format, isAligned ] = formatEntry;
                let section;
                if (sectionClass == arrayAssetsFileSection) { //combine, maybe class factory?
                    section = new arrayAssetsFileSection(typeStringOffset, nameStringOffset, format, isAligned, this.typeTreeEntry);
                } else if(sectionClass == containerAssetsFileSection) {
                    section = new containerAssetsFileSection(typeStringOffset, nameStringOffset, format, isAligned, this.typeTreeEntry);
                }
                //if (true || this.getType() == 'Transform') console.log(section.getName());

                const currentOffset = this.fileData.getOffset();

                yield *section;

                let name = section.getName();
                if (this.has(name)) {
                    name = name + currentOffset;
                }
                this.set(name, section);
            }
        }
    }

    *[Symbol.iterator]() {
        //const offsetStart = this.fileData.getOffset();
        const currentOffset = this.fileData.getOffset();

        yield *super[Symbol.iterator]();

        this.sectionSize = this.fileData.getOffset() - currentOffset;
        //if (this.isAligned) {

            yield this.align();

        //}
    }

    align() {
        return dataObjectFactory(['skip', this.isAligned ? alignTo(this.fileData.getAssetsFileSize(), 4) : 0, SKIP]);
    }

    *iterate() {

        yield *this.buildSection();

    }

    getString(offset) {
        const string = this.typeTreeEntry.getStringTableEntry(offset);
        if (string) {
            return string;
        } else {
            return typeNameStrings.get(offset);
        }
    }

    getType() {
        return this.getString(this.typeStringOffset);
    }

    getName() {
        return this.getString(this.nameStringOffset);
    }
}

class assetsFileRoot extends assetsFileSection {
    //constructor(typeStringOffset, nameStringOffset, typeTreeEntry) {
    constructor(typeStringOffset, nameStringOffset, format, typeTreeEntry) {
        //super(typeStringOffset, nameStringOffset, [], undefined, typeTreeEntry);
        super(typeStringOffset, nameStringOffset, format, undefined, typeTreeEntry);

        this.lastFile = false;
    }

    *iterate() {

        //const offsetStart = this.fileData.fileReader.getOffset();

        yield *this.buildSection();

        /*if (!this.isLastFile()) {

            const fileSize = this.fileData.fileReader.getOffset() - offsetStart;

            yield dataObjectFactory(['skip', alignTo(fileSize, 8), SKIP]);

        }*/
    }

    align() {
        //console.log('--------------------------before file skip')

        //if (!this.isLastFile()) {
            //console.log('--------------------------file skip')
            return dataObjectFactory(['skip', !this.isLastFile() ? alignTo(this.fileData.getAssetsFileSize(), 8) : 0, SKIP]);
        //}
    }

    isLastFile(is) {
        if (is) {
            this.lastFile = true;
            return true;
        } else {
            return this.lastFile;
        }
    }
}

class arrayAssetsFileSection extends assetsFileSection {
    *iterate() {
        //const offsetStart = this.fileData.fileReader.getOffset();
        const sizeSection = dataObjectFactory(['size', 4, INT, this.littleEndian]);

        yield sizeSection;

        for (let index = 1; index <= sizeSection.data; index = index + 1) {

            yield *this.buildSection();

        }

        /*if (this.isAligned) {
            const arraySize = this.fileData.fileReader.getOffset() - offsetStart;

            yield dataObjectFactory(['skip', alignTo(arraySize, 4), SKIP]);

        }*/

    }

    *[Symbol.iterator]() {
        if (this.isInitialized) { //we already check this in a parent's iterator, fix
            const sizeSection = dataObjectFactory(['size', 4, INT, this.littleEndian]);
            sizeSection.data = this.size;

            yield sizeSection;

        }

        yield *super[Symbol.iterator]();

    }

    getValues() {
        return Reflect.apply(new Map()[Symbol.iterator], this, []);
    }
}

class containerAssetsFileSection extends assetsFileSection {
    *iterate() {
        //const offsetStart = this.fileData.fileReader.getOffset();

        yield *this.buildSection();

        /*if (this.isAligned) {
            const containerSize = this.fileData.fileReader.getOffset() - offsetStart;

            yield dataObjectFactory(['skip', alignTo(containerSize, 4), SKIP]);

        }*/
    }
}

function dataObjectFactory(format) {
    return Object.create(dataObject).init(format);
}

function dataFileObjectFactory(format) {
    //console.log(format.slice(0, -1));
    return Object.create(fileDataObject).setup(format);
}

function textureDataObjectFactory(format) {
    return Object.create(textureDataObject).setup(format);
}

const dataObject = {
    init: function(format) {
        [ this.name, this.size, this.type, this.littleEndian, this.isAligned ] = format;

        return this;
    },

    [Symbol.iterator]: function *() {

        yield this;/////

        if (this.type == TEXT_NULL) {

            //yield { name: 'skip', size: 1, type: SKIP };
            yield dataObjectFactory(['skip', 1, SKIP]);

        } else if (this.isAligned) {

            //yield { name: 'skip', size: alignTo(this.size, 4), type: SKIP };
            if (this.typeTreeEntry) {

                //yield { name: 'skip', size: alignTo(this.typeTreeEntry.fileData.fileReader.getOffset(), 4), type: SKIP };
                yield { name: 'skip', size: alignTo(/*this.typeTreeEntry.fileData.fileReader.getOffset() - 
                                                    this.typeTreeEntry.fileData.get('assetsFileHeader').get('metadataSize').absoluteOffset*/this.typeTreeEntry.fileData.getAssetsFileSize(), 4), type: SKIP };  //

            } else {

                yield { name: 'skip', size: alignTo(this.size, 4), type: SKIP };

            }

            //console.log('skip: ' + alignTo(this.size, 4));

        }
    }
};

const fileDataObject = Object.create(dataObject);

fileDataObject.setup = function(format) {
    //console.log(format);
    [ this.typeStringOffset, this.nameStringOffset ] = format;
    this.typeTreeEntry = format[format.length - 1];

    return this.init([this.getName(), ...format.slice(2, -1)]);
};

fileDataObject[Symbol.iterator] = function *() { //fix this mess of a function
    var size;
    if (this.type == TEXT || this.type == BUFFER) {
        size = dataObjectFactory(['size', 4, INT, true]); //fix the hardcoded endian
        if (this.size != 0) {
            this.size = this.data.length ? textEncoder.encode(this.data).length : this.data.byteLength; //fix this
            size.data = this.size;
        }
    
        yield size;
    
        if (this.size == 0) {
            this.size = size.data;
        }
    }

    if (!(this.size == 0 && typeof size != 'undefined' && size.data == 0)) {

        yield *dataObject[Symbol.iterator].bind(this)();

    }
};

fileDataObject.getString = function(offset) {
    const string = this.typeTreeEntry.getStringTableEntry(offset);
    if (string) {

        return string;
    } else {

        return typeNameStrings.get(offset);
    }
};

fileDataObject.getType = function() {
    return this.getString(this.typeStringOffset);
};

fileDataObject.getName = function() {
    return this.getString(this.nameStringOffset);
};

const textureDataObject = Object.create(dataObject);

textureDataObject.setup = function(format) {
    [ this.textureFile ] = format;

    return this.init(format.slice(1));
};

function readBundle(buffer) {
    const fileDataView = new DataView(buffer);
    const fileReader = Object.create(reader).setup(fileDataView);

    const fileData = new container();
    fileData.fileReader = fileReader; //fix this

    fileData.set('bundleHeader',
                 new fileSection([
                                     ['signature', 0, TEXT_NULL],
                                     ['fileVersion', 4, INT],
                                     ['minPlayerVersion', 0, TEXT_NULL],
                                     ['engineVersion', 0, TEXT_NULL],
                                     ['fileSize', 8, INT],
                                     ['headerCompressedSize', 4, INT],
                                     ['headerDecompressedSize', 4, INT],
                                     ['headerFlags', 4, INT]
                                 ],
                                 fileData)
                );
    fileReader.read(fileData.get('bundleHeader'));

    var currentOffset = fileReader.getOffset();
    const bufferParts = [buffer.slice(0, currentOffset)];
    const compressedSize = fileData.getData('bundleHeader/headerCompressedSize');
    const decompressedSize = fileData.getData('bundleHeader/headerDecompressedSize');

    switch (fileData.getData('bundleHeader/headerFlags') & 0x3f) {
        case 0:
            bufferParts.push(buffer.slice(currentOffset, currentOffset + decompressedSize));
            break;
        case 3:
            const compressedList = Buffer.from(buffer.slice(currentOffset, currentOffset + compressedSize));
            const decompressedList = Buffer.alloc(decompressedSize);
            lz4.decodeBlock(compressedList, decompressedList);
            bufferParts.push(decompressedList.buffer);
    }

    //console.log(currentOffset, decompressedSize);
    //console.log(bufferParts);
    //console.log(concatBuffers(bufferParts));
    fileReader.view = new DataView(concatBuffers(bufferParts));

    fileData.set('bundleBlockListHeader',
                 new fileSection([
                                     ['checksumLow', 8, INT],
                                     ['checksumHigh', 8, INT],
                                     ['blockCount', 4, INT]
                                 ],
                                 fileData)
                );
    fileReader.read(fileData.get('bundleBlockListHeader'));

    fileData.set('blockList',
                 new fileSectionList([
                                         ['blockDecompressedSize', 4, INT],
                                         ['blockCompressedSize', 4, INT],
                                         ['blockFlags', 2, INT]
                                     ],
                                     fileData.getBlockCount(),
                                     'block',
                                     fileData)
                );
    fileReader.read(fileData.get('blockList'));

    fileData.set('bundleDirListHeader',
                 new fileSection([
                                     ['dirCount', 4, INT]
                                 ],
                                 fileData)
                );
    fileReader.read(fileData.get('bundleDirListHeader'));

    fileData.set('dirList',
                 new fileSectionList([
                                         ['dirOffset', 8, INT],
                                         ['dirDecompressedSize', 8, INT],
                                         ['dirFlags', 4, INT],
                                         ['dirName', 0, TEXT_NULL]
                                     ],
                                     fileData.getDirCount(),
                                     'dir',
                                     fileData)
                );
    fileReader.read(fileData.get('dirList'));
    
    currentOffset = currentOffset + compressedSize;
    var blockOffset = 0;
    for (const blockInfo of fileData.get('blockList').values()) {
        const compressedSize = blockInfo.getData('blockCompressedSize');
        const decompressedSize = blockInfo.getData('blockDecompressedSize');
        const flags = blockInfo.getData('blockFlags');

        switch (flags & 0x3f) {
            case 0:
                bufferParts.push(buffer.slice(currentOffset + blockOffset, currentOffset + blockOffset + decompressedSize));
                blockOffset = blockOffset + decompressedSize;
                break;
            case 3:
                const compressedBlock = Buffer.from(buffer.slice(currentOffset + blockOffset, currentOffset + blockOffset + compressedSize));
                const decompressedBlock = Buffer.alloc(decompressedSize);
                lz4.decodeBlock(compressedBlock, decompressedBlock);
                bufferParts.push(decompressedBlock.buffer);
                blockOffset = blockOffset + compressedSize;
        }
    }

    fileReader.view = new DataView(concatBuffers(bufferParts));
    
    fileData.set('assetsFileHeader',
                 new fileSection([
                                     ['metadataSize', 4, INT],
                                     ['assetsFileSize', 4, INT],
                                     ['format', 4, INT],
                                     ['firstFileOffset', 4, INT],
                                     ['endianness', 1, INT], //0 - little, 1 - big
                                     ['unknown1', 1, INT],
                                     ['unknown2', 1, INT],
                                     ['unknown3', 1, INT],
                                 ],
                                 fileData)
                );
    fileReader.read(fileData.get('assetsFileHeader'));

    fileData.set('typeTreeHeader',
                 new fileSection([
                                     ['unityVersion', 0, TEXT_NULL],
                                     ['platform', 4, INT],
                                     ['hasTypeTree', 1, INT],
                                     ['entryCount', 4, INT]
                                 ],
                                 fileData)
                );
    fileReader.read(fileData.get('typeTreeHeader'));

    fileData.set('typeTreeList',
                 new fileSectionTypeTreeEntryList([
                                                  ['classId', 4, INT],
                                                  ['unknown1', 1, INT],
                                                  ['scriptIndex', 2, INT],

                                                  ['scriptId', fileSectionCondition, [
                                                      ['unknown1', 4, INT],
                                                      ['unknown2', 4, INT],
                                                      ['unknown3', 4, INT],
                                                      ['unknown4', 4, INT]
                                                  ],
                                                  fileData, //remove this
                                                  () => fileReader.lookBack(7, dataObjectFactory(['classId', 4, INT, fileData.isLittleEndian()])).data == 114], //returns true if MonoBehaviour or false otherwise

                                                  ['typeHash', fileSection, [
                                                      ['unknown1', 4, INT],
                                                      ['unknown2', 4, INT],
                                                      ['unknown3', 4, INT],
                                                      ['unknown4', 4, INT]
                                                  ]],

                                                  ['fieldCount', 4, INT],
                                                  ['stringTableLen', 4, INT],

                                                  ['fieldList', fileSectionFieldList, [
                                                      ['version', 2, INT],
                                                      ['depth', 1, INT],
                                                      ['isArray', 1, INT],
                                                      ['typeStringOffset', 4, INT],
                                                      ['nameStringOffset', 4, INT],
                                                      ['size', 4, INT],
                                                      ['index', 4, INT],
                                                      ['flags', 4, INT],
                                                  ]],

                                                  ['stringTable', fileSectionStringTable, [
                                                      ['string', 0, TEXT_NULL]
                                                  ]],
                                            ],
                                            fileData.getTypeTreeEntryCount(),
                                            'typeTreeEntry',
                                            fileData)
                );
    fileReader.read(fileData.get('typeTreeList'));

    fileData.set('fileListCount',
                 dataObjectFactory(['fileListCount', 4, INT, fileData.isLittleEndian()]));
    fileReader.read(fileData.get('fileListCount'));

    const typeTreeSize = fileReader.getOffset() - fileData.get('typeTreeHeader').get('unityVersion').absoluteOffset;
    fileData.set('typeTreeAlignBytes',
                 dataObjectFactory(['skip', alignTo(typeTreeSize, 4), SKIP]));
    fileReader.read(fileData.get('typeTreeAlignBytes'));

    fileData.set('fileInfoList',
                 new fileSectionList([
                    ['index', 8, S_INT],
                    ['offset', 4, INT],
                    ['size', 4, INT],
                    ['fileTypeOrIndex', 4, INT],
                 ],
                 fileData.getData('fileListCount'),
                 'fileInfo',
                 fileData));
    fileReader.read(fileData.get('fileInfoList'));

    fileData.set('preloadListCount',
                 dataObjectFactory(['preloadListCount', 4, INT, fileData.isLittleEndian()]));
    fileReader.read(fileData.get('preloadListCount'));

    fileData.set('preloadList',
                 new fileSectionList([
                     ['fileId', 4, INT],
                     ['pathId', 8, INT]
                 ],
                 fileData.getData('preloadListCount'),
                 'preloadEntry',
                 fileData));
    fileReader.read(fileData.get('preloadList'));

    fileData.set('assetsFileDependencyCount',
                 dataObjectFactory(['assetsFileDependencyCount', 4, INT, fileData.isLittleEndian()]));
    fileReader.read(fileData.get('assetsFileDependencyCount'));

    fileData.set('assetsFileDependencyList',
                 new fileSectionList([
                     ['guidMostSignificant', 8, INT],
                     ['guidLeastSignificant', 8, INT],
                     ['type', 4, INT],
                     ['unknown', 1, INT],
                     ['assetPath', 0, TEXT_NULL]
                 ],
                 fileData.getData('assetsFileDependencyCount'),
                 'assetsFileDependencyEntry',
                 fileData));
    fileReader.read(fileData.get('assetsFileDependencyList'));

    const zeroCount = fileData.get('assetsFileHeader').get('metadataSize').absoluteOffset + fileData.getData('assetsFileHeader/firstFileOffset') - fileReader.getOffset();
    fileData.set('zeroList',
                 new fileSectionList([
                     ['zero', 1, INT]
                 ],
                 zeroCount,
                 'zero',
                 fileData));
    fileReader.read(fileData.get('zeroList'));

    const rec = function rec(field) {
        //console.log(field.values());
        for (const entry of field.values()) {
            if (entry instanceof Map) {
                //console.log(`${'.'.repeat(entry.getData('depth'))} ${entry.getType()} ${entry.getName()} ali: ${entry.isAligned()} arr: ${entry.isArray()} size: ${entry.getData('size')} off: ${entry.get('flags').absoluteOffset}`);
                rec(entry);
            }
        }
    };

    typeTree: for (const typeTree of fileData.get('typeTreeList')) {
        //console.log(typeTree);
        for (const filedArr of typeTree[1].get('fieldList')) {
            const field = filedArr[1];
            //console.log(field);
            if (true || field.getName() == 'Base' && field.getType() == 'Shader') {
                console.log(field.getName(), field.getType());
                //console.log(`${'.'.repeat(field.getData('depth'))} ${field.getType()} ${field.getName()} ${field.isAligned()} ${field.isArray()}`);
                rec(field);
            } else {
                continue typeTree;
            }
        }
    }

    const fileInfoArray = fileData.fileInfoArray = Array.from(fileData.get('fileInfoList').values());
    const sortedFileInfoArray = fileData.sortedFileInfoArray = Array.from(fileInfoArray).sort((a, b) => a.getData('offset') - b.getData('offset'));
    const typeTreeEntryArray = Array.from(fileData.get('typeTreeList').values());
    const secondDir = []; //assume we can only have up to 2 dirs and if a second dir exists it contains Texture2D
    fileData.fonts = [];
    fileData.pathIds = new Map();
    fileData.set('files', new Map());
    for (let fileIndex = 0; fileIndex < sortedFileInfoArray.length; fileIndex = fileIndex + 1) {
        const typeTreeEntryIndex = sortedFileInfoArray[fileIndex].getData('fileTypeOrIndex');
        const index = sortedFileInfoArray[fileIndex].getData('index');
        const typeTreeEntry = typeTreeEntryArray[typeTreeEntryIndex];
        const fieldList = typeTreeEntry.get('fieldList');
        const [ type, name, format ] = fieldList.assetsFileFormat;
        const assetsFile = new assetsFileRoot(type, name, format, typeTreeEntry);
        fileData.get('files').set(assetsFile.getName() + fileReader.getOffset(), assetsFile);
        //console.log('file: ', assetsFile.getType());
        //console.log('pathID: ', sortedFileInfoArray[fileIndex].getData('index'), assetsFile.getName());
        if (fileIndex + 1 == sortedFileInfoArray.length) {
            assetsFile.isLastFile(true);
        }

        if (assetsFile.getType() == 'Texture2D') {
            secondDir.push(assetsFile);
        }

        if (assetsFile.getType() == 'Font') {
            fileData.fonts.push(assetsFile);
        }

        fileReader.read(assetsFile);
        fileData.pathIds.set(index, assetsFile);
    }

    if (secondDir.length > 0) {
        const textures = new Map();
        fileData.set('textures', textures);
        secondDir.sort((a, b) => {
            return a.getData('m_StreamData/offset') - b.getData('m_StreamData/offset');
        });
        for (const textureFile of secondDir) {
            if (textureFile.getData('m_ImageCount') == 0) {
                continue;
            }
            const name = textureFile.getData('m_Name');
            const width = textureFile.getData('m_Width');
            const height = textureFile.getData('m_Height');
            const format = textureFile.getData('m_TextureFormat');
            const textureBlobObject = textureDataObjectFactory([textureFile, 'Texture2D', textureFile.getData('m_StreamData/size'), BUFFER]);
            fileReader.read(textureBlobObject);
            textures.set(name, textureBlobObject);
            /*let fileName = `images/${name}`, buffer;
            if (format == 47) {
                fileName = `${fileName}.pkm`;
                buffer = Buffer.concat([Buffer.from(`504B4D2032300003${(width.toString(16).padStart(4, '0') + height.toString(16).padStart(4, '0')).repeat(2)}`, 'hex'), Buffer.from(textureBlobObject.data)]);
            } else if (format == 4) {
                fileName = `${fileName}_${width}x${height}.rgba`;
                buffer = Buffer.from(textureBlobObject.data);
            } else if (format == 3) {
                fileName = `${fileName}_${width}x${height}.rgb`;
            } else if (format == 1) {
                fileName = `${fileName}_${width}x${height}.alpha8`;
            }*/
            //console.log(filePath, format, fileName);
            //await fsp.writeFile(`images/${name}.pkm`, Buffer.concat([Buffer.from(`504B4D2032300003${(width.toString(16).padStart(4, '0') + height.toString(16).padStart(4, '0')).repeat(2)}`, 'hex'), Buffer.from(textureBlobObject.data)]));
            //await fsp.writeFile(fileName, buffer);
        }
    }
    
    return fileData;
}

function writeBundle(fileData) {
        //set the same amont of blocks as we have dirs
    const blockList = fileData.get('blockList');
    const dirCount = fileData.getData('bundleDirListHeader/dirCount');
    const blockListArray = [...blockList].slice(0, dirCount);
    blockList.clear();
    blockListArray.forEach((entry) => { blockList.set(entry[0], entry[1]) });
    const blockCountObject = fileData.getSection('bundleBlockListHeader/blockCount');
    blockCountObject.data = dirCount;

    const serizlizedBuffer = new ArrayBuffer(30000000);
    const writerDataView = new DataView(serizlizedBuffer);
    const fileWriter = Object.create(writer).setup(writerDataView);
    //console.log('oooooooooooofset', fileWriter.getOffset());
    //console.log('---');
    fileData.fileWriter = fileWriter;

    let headerSize,
        headerOffset,
        dirSizes = [],
        dirOffsets = [];
    for (const [ name, mapOrObject ] of fileData) {
        if (name == 'files') {
            const files = [...mapOrObject.values()];
            let offset = 0;
            const fileInfoWriter = Object.create(writer).setup(writerDataView, fileData.fileInfoArray[0].get('index').absoluteOffset);
            for (let fileIndex = 0; fileIndex < fileData.sortedFileInfoArray.length; fileIndex = fileIndex + 1) {
                const fileInfo = fileData.sortedFileInfoArray[fileIndex];
                const file = files[fileIndex];
                //console.log('pathID: ', fileInfo.getData('index'), file.getName());
                const currentOffset = fileWriter.getOffset();
                fileWriter.write(file);
                fileInfo.get('offset').data = offset;
                fileInfo.get('size').data = file.sectionSize;
                //fileInfoWriter.write(fileInfo);
                offset = offset + (fileWriter.getOffset() - currentOffset);
            }

            dirSizes[0] = fileWriter.getOffset() - dirOffsets[0];
            fileInfoWriter.write(fileData.get('fileInfoList'));
        } else if (name == 'textures') {
            dirOffsets[1] = fileWriter.getOffset();

            let offset = 0;
            for (const [ name, texture ] of mapOrObject) {
                fileWriter.write(texture);

                const offsetObject = texture.textureFile.get('m_StreamData').get('offset');
                const sizeObject = texture.textureFile.get('m_StreamData').get('size');

                offsetObject.data = offset;
                sizeObject.data = texture.data.byteLength;

                fileWriter.writeAt(offsetObject.absoluteOffset, offsetObject);
                fileWriter.writeAt(sizeObject.absoluteOffset, sizeObject);

                offset = offset + texture.data.byteLength;
            }
            
            dirSizes[1] = fileWriter.getOffset() - dirOffsets[1];
        } else {
            if (name == 'bundleBlockListHeader') {
                headerOffset = fileWriter.getOffset();
            } else if (name == 'assetsFileHeader') {
                headerSize = fileWriter.getOffset() - headerOffset;
                dirOffsets[0] = fileWriter.getOffset();
            }
            fileWriter.write(mapOrObject);
        }
        //console.log(mapOrObject);
    }

    const updateData = function(path, data) {
        const dataObject = fileData.getSection(path);
        dataObject.data = data;
        fileWriter.writeAt(dataObject.absoluteOffset, dataObject);
    };

    updateData('assetsFileHeader/assetsFileSize', dirSizes[0]);

    const bufferParts = [];
    let totalCompressedSize = 0;

    for (let dirCount = 1, dirOffset = 0, dirSize = dirSizes[dirCount - 1];
         dirCount <= dirSizes.length;
         dirOffset = dirOffset + dirSizes[dirCount - 1], dirCount = dirCount + 1, dirSize = dirSizes[dirCount - 1]) {
        const dirOffsetAbsolute = dirOffsets[dirCount - 1];

        const dirUncompressedBuffer = Buffer.from(serizlizedBuffer.slice(dirOffsetAbsolute, dirOffsetAbsolute + dirSize));
        let dirCompressedBuffer = new Buffer(lz4.encodeBound(dirUncompressedBuffer.length));
        const dirCompressedSize = lz4.encodeBlock(dirUncompressedBuffer, dirCompressedBuffer);
        dirCompressedBuffer = dirCompressedBuffer.slice(0, dirCompressedSize);
        bufferParts.push(dirCompressedBuffer.buffer.slice(0, dirCompressedSize));

        updateData(`dirList/dir${dirCount}/dirOffset`, dirOffset);
        updateData(`dirList/dir${dirCount}/dirDecompressedSize`, dirSize);

        updateData(`blockList/block${dirCount}/blockCompressedSize`, dirCompressedSize);
        updateData(`blockList/block${dirCount}/blockDecompressedSize`, dirSize);
        //console.log(dirCount, dirSize);

        totalCompressedSize = totalCompressedSize + dirCompressedBuffer.length;
    }

    const headerUncompressedBuffer = Buffer.from(serizlizedBuffer.slice(headerOffset, headerOffset + headerSize));
    let headerCompressedBuffer = new Buffer(lz4.encodeBound(headerUncompressedBuffer.length));
    const headerCompressedSize = lz4.encodeBlock(headerUncompressedBuffer, headerCompressedBuffer);
    console.log(headerOffset, headerSize, headerUncompressedBuffer.toString('hex'));
    console.log(serizlizedBuffer.slice(headerOffset, headerSize));
    headerCompressedBuffer = headerCompressedBuffer.slice(0, headerCompressedSize);
    bufferParts.unshift(headerCompressedBuffer.buffer.slice(0, headerCompressedSize));

    totalCompressedSize = totalCompressedSize + headerCompressedBuffer.length + headerOffset;

    updateData('bundleHeader/fileSize', totalCompressedSize);
    updateData('bundleHeader/headerCompressedSize', headerCompressedSize);
    updateData('bundleHeader/headerDecompressedSize', headerSize);

    const beginningBuffer = serizlizedBuffer.slice(0, headerOffset);
    bufferParts.unshift(beginningBuffer);

    let sum = 0;
    for (const [ blockName, blockInfo ] of fileData.get('blockList')) {
        const size = blockInfo.getData('blockCompressedSize');
        console.log(`block name ${blockName}, size: ${size}`);
        sum = sum + size;
    }

    //return serizlizedBuffer.slice(0, fileWriter.getOffset());
    console.log(bufferParts);
    return concatBuffers(bufferParts);
}

export { readBundle, writeBundle };
/*(async function() {
    const fileBuffer = await fsp.readFile(filePath);

    const fileData = readBundle(fileBuffer.buffer);
    //set the same amont of blocks as we have dirs
    /*const blockList = fileData.get('blockList');
    const dirCount = fileData.getData('bundleDirListHeader/dirCount');
    const blockListArray = [...blockList].slice(0, dirCount);
    blockList.clear();
    blockListArray.forEach((entry) => { blockList.set(entry[0], entry[1]) });
    const blockCountObject = fileData.getSection('bundleBlockListHeader/blockCount');
    blockCountObject.data = dirCount;

    //change font
    const font = fileData.fonts[0];
    const fontData = font.get('m_FontData');

    const fontSize = font.get('m_FontSize');
    //fontSize.data = 150;

    const fontame = font.get('m_Name');
    fontame.data = 'test';

    const fontNames = [...font.get('m_FontNames').get('Array').get('data')];
    const fontName = fontNames[1];
    console.log('font name: ', fontName.data);
    fontName.data = 'test';

    const newFontBuffer = await fsp.readFile('A-OTF-SeiKaiCB1Std-Regular.otf');
    fontData.data = newFontBuffer.buffer;*

    const serizlizedBuffer = writeBundle(fileData);
    //console.log(`total ${sum} in ${fileData.get('blockList').size} blocks`);

    await fsp.writeFile(`${filePath}.serialized`, Buffer.from(serizlizedBuffer));
    //console.log('oooooooooooofset', fileWriter.getOffset());

    //console.log(fileData.getData('typeTreeList/typeTreeEntry5/fieldList').assetsFile.format);
})();*/