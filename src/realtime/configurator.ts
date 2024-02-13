/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Metric } from './baseMetric';
import styles from './configurator.css';
import { Settings } from './settings';

export class Configurator {
    private metrics = new Map<
        Metric,
        {
            element: HTMLElement;
            value: HTMLElement;
            enabled: boolean;
            available: boolean;
        }
    >();

    public elem = document.createElement('div');

    public dispose = this.settings.onChange(() => this.applySettings());

    constructor(private readonly settings: Settings) {
        this.elem.classList.add(styles.configurator);
        this.update();
        this.applySettings();
    }
    public update() {
        while (this.elem.firstChild) {
            this.elem.removeChild(this.elem.firstChild);
        }
        this.metrics.clear();

        const addedMetrics = new Set<string>();
        for (const metric of this.settings.allMetrics) {
            if (addedMetrics.has(metric.notebook)) {
                continue;
            }
            addedMetrics.add(metric.notebook);
            const element = document.createElement('div');
            element.classList.add(styles.metric);
            element.addEventListener('click', () => this.settings.toggleMetric(metric));

            const label = document.createElement('span');
            label.classList.add(styles.label);
            label.innerText = metric.name();
            element.appendChild(label);

            const value = document.createElement('span');
            value.classList.add(styles.value);
            element.appendChild(value);

            this.metrics.set(metric, { element, enabled: false, available: false, value });
            this.elem.appendChild(element);
        }

        // move inactive items to the bottom always
        for (const { element, enabled } of this.metrics.values()) {
            if (!enabled) {
                this.elem.appendChild(element);
            }
        }
    }
    /**
     * Updates the configurator state for the metrics.
     */
    public updateMetrics() {
        for (const [metric, m] of this.metrics) {
            if (metric.hasData() !== m.available) {
                m.available = metric.hasData();
                m.element.classList[metric.hasData() ? 'add' : 'remove'](styles.available);
            }
        }
    }

    /**
     * Updates the value displayed for the given metric.
     */
    public updateMetric(
        val: HTMLElement,
        { metric, value: currentValue }: { metric: Metric; value: number },
        matchingMetric: { metric?: Metric; value?: number },
    ) {
        const m = this.metrics.get(metric);
        if (!m) {
            val.innerText = metric.format(currentValue);
            return;
        }

        if (metric.hasData() !== m.available) {
            m.available = metric.hasData();
            m.element.classList[metric.hasData() ? 'add' : 'remove'](styles.available);
        }

        if (m.available) {
            if (!matchingMetric.metric) {
                m.value.innerText = metric.format(currentValue);
                val.innerText = m.value.innerText;
                return;
            }
            m.value.innerText =
                metric.type === 'cpu'
                    ? `${metric.format(currentValue)}, ${matchingMetric.metric.format(matchingMetric.value || 0)}`
                    : `${matchingMetric.metric.format(matchingMetric.value || 0)}, ${metric.format(currentValue)}`;
            val.innerText = m.value.innerText;
        }
    }

    private applySettings() {
        this.update();
        for (const [metric, m] of this.metrics.entries()) {
            if (metric.notebook && !this.settings.value.monitoringNotebooks.includes(metric.notebook)) {
                continue;
            }
            m.enabled = this.settings.enabledMetrics.includes(metric);
            m.element.classList[m.enabled ? 'add' : 'remove'](styles.enabled);
            m.element.style.setProperty('--metric-color', this.settings.metricColor(metric));
        }
    }
}
