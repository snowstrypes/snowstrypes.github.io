import { readBundle, writeBundle } from './kf3bundle.js';

function promisify(func, thisObject) {
    return function promisifiedFunction(...args) {
        return new Promise(function handleFunc(resolve, reject) {
            try {
                resolve(func.apply(thisObject, args));
            } catch(error) {
                reject(error);
            }
        });
    };
}

function promisifyEventListener(object, eventType) {
    return new Promise(function resolveEvent(resolve, reject) {
        try {
            object.addEventListener(eventType, function callback(eventObject) {
                resolve(eventObject);
            })
        } catch(error) {
            reject(error);
        }
    });
}

(async function IIAFE() {
    await promisifyEventListener(window, 'load');

    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', async function(fileEvenObject) {
        const file = fileEvenObject.target.files[0];
        const reader = new FileReader();
        const fileReadPromise = promisifyEventListener(reader, 'load');
        reader.readAsArrayBuffer(file);
        const mapObjects = readBundle((await fileReadPromise).target.result);
        const table = document.getElementById('rows');
        while (table.firstChild) {
            table.removeChild(table.lastChild);
        }
    
        for (const file of mapObjects.get('files').values()) {
            if (file.getType() == 'MonoBehaviour') {
                for (const rowData of file.get('rowDatas').get('Array').values()) {
                    const type = rowData.getData('mType');
                    if ([1, 2, 3, 8].includes(type)) {
                        const lines = Array.from(rowData.get('mStrParams').get('Array').values(), map => map.data).filter(line => line && line != 'none');
                        console.log(type, rowData.getData('mSerifCharaName'), lines);
    
                        var row = document.createElement('tr');
                        var nameCol = document.createElement('td');
                        const charName = rowData.getData('mSerifCharaName');
                        nameCol.appendChild(document.createTextNode(charName ? charName : ''));
                        row.appendChild(nameCol);
                        table.appendChild(row);
                        for (let lineIndex = 0; lineIndex < lines.length; lineIndex = lineIndex + 1) {
                            const line = lines[lineIndex];
                            const formattedText = line.replace('\n', '<br>')
                                                      .replace(/<color=#(\w{6})>(.*?)<\/color>/g, '<span style="color: #$1">$2</span>')
                                                      .replace(/\[(.*?):(.*?)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
                            var textCol = document.createElement('td');
                            textCol.innerHTML = formattedText;
                            /*textCol.childNodes.forEach(function colorizeSpans(child) {
                                if (child.tagName == 'span') {
                                    const color = child.getAttribute('color');
                                    if (color) {

                                    }
                                }
                            });*/
                            if (lineIndex == 0) {
                                row.appendChild(textCol);
                            } else {
                                const additionalRow = document.createElement('tr');
                                additionalRow.appendChild(textCol);
                                table.appendChild(additionalRow);
                            }
                        }
    
                        if (lines.length > 1) {
                            nameCol.setAttribute('rowspan', lines.length);
                        }
                    }
                }
            }
        }
    });  
})();