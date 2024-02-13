/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Chart } from './chart';
import style from './client.css';
import { MessageType, ToWebViewMessage } from './protocol';
import { Settings } from './settings';
import { api } from './vscodeApi';

const settings = new Settings(api);

const chart = new Chart(window.innerWidth, window.innerHeight, settings);

window.addEventListener('message', (evt) => {
    const data = evt.data as ToWebViewMessage;
    switch (data.type) {
        case MessageType.AddData:
            for (const m of settings.allMetrics) {
                m.update(data.data.timestamp, data.data);
            }
            chart.updateMetrics();
            break;
        case MessageType.BatchAddData:
            for (const dataItem of data.data) {
                for (const m of settings.allMetrics) {
                    m.update(dataItem.timestamp, dataItem);
                }
            }
            chart.updateMetrics();
            break;
        case MessageType.UpdateSettings:
            for (const m of settings.allMetrics) {
                m.reset(data.settings.viewDuration, data.settings.pollInterval);
            }
            settings.update(data.settings);
            break;
        case MessageType.ApplyData:
            // for (let i = 0; i < data.data.length; i++) {
            //     settings.allMetrics[i].setData(data.data[i]);
            // }
            chart.updateMetrics();
            updateSize();
            break;
        case MessageType.ClearData:
            for (const metric of settings.allMetrics) {
                metric.setData([]);
            }
            chart.updateMetrics();
            updateSize();
            break;
        default:
        // ignored
    }
});

document.body.classList.add(style.body);
document.body.appendChild(chart.elem);

const updateSize = () => chart.updateSize(window.innerWidth, window.innerHeight);
new ResizeObserver(updateSize).observe(document.body);

(function observeDprChanges() {
    // Observer inspired by https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
    const observer = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const listener = () => {
        // Seems like this needs a timeout. I don't know why:
        setTimeout(updateSize, 500);
        observer.removeEventListener('change', listener);
        observeDprChanges();
    };

    observer.addEventListener('change', listener);
})();
