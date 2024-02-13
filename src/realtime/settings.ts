/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Color, observeColors } from 'vscode-webview-tools';
import { Metric } from './baseMetric';
import { HostCpuMetric, KernelCpuMetric, KernelMemoryMetric, createMetrics } from './metrics';
import { IDAMetrics, ISettings, MessageType, getSteps } from './protocol';
import { IVscodeApi } from './vscodeApi';

export class Settings {
    private changeListeners: (() => void)[] = [];

    public value: ISettings = {
        pollInterval: 1_000,
        viewDuration: 30_000,
        zoomLevel: 0,
        enabledMetrics: [{ type: 'cpu', notebook: '' }],
        monitoringNotebooks: [],
        showCpu: true,
        showMemory: true,
        easing: true
    };

    public colors!: {
        background: string;
        border: string;
        foreground: string;
        graphs: string[];
    };

    public allMetrics: (HostCpuMetric | KernelCpuMetric | KernelMemoryMetric)[] = createMetrics();

    public get enabledMetrics() {
        const enabledMetrics = new Set(this.value.enabledMetrics.map((m) => `${m.type}:${m.notebook}`));
        return this.allMetrics.filter((m) => enabledMetrics.has(`${m.type}:${m.notebook}`));
    }
    public steps = 0;

    constructor(private readonly api: IVscodeApi) {
        this.update(this.value);

        observeColors((c) => {
            this.colors = {
                background: c[Color.SideBarBackground],
                foreground: c[Color.SideBarForeground] || c[Color.Foreground],
                border: c[Color.TreeIndentGuidesStroke],
                graphs: [
                    c[Color.ChartsRed],
                    c[Color.ChartsYellow],
                    c[Color.ChartsBlue],
                    c[Color.ChartsOrange],
                    c[Color.ChartsPurple],
                    c[Color.ChartsGreen]
                ]
            };
            this.fireChange();
        });
    }

    public metricColor(metric: Metric) {
        const colors = this.colors.graphs;
        if (!metric.notebook) {
            return colors[0];
        }
        const notebooks = Array.from(new Set(this.allMetrics.filter((m) => m.notebook).map((m) => m.notebook)));
        const notebookIndex = notebooks.indexOf(metric.notebook);
        return colors[(notebookIndex % (colors.length - 1)) + 1]; // Exclude the first item
    }

    public onChange(listener: () => void) {
        this.changeListeners.push(listener);
        return () => (this.changeListeners = this.changeListeners.filter((c) => c !== listener));
    }

    public setEnabledMetrics(metrics: ReadonlyArray<Metric>) {
        if (metrics.length === this.enabledMetrics.length && !metrics.some((m) => !this.enabledMetrics.includes(m))) {
            return;
        }

        this.api.postMessage({
            type: MessageType.SetEnabledMetrics,
            keys: metrics.map((m) => ({ type: m.type, notebook: m.notebook }))
        });

        this.fireChange();
    }

    public toggleMetric(metric: Metric) {
        const metrics = new Set(this.allMetrics.filter((m) => m.notebook === metric.notebook));
        const enabledMetrics = this.enabledMetrics.some((m) => metrics.has(m))
            ? this.enabledMetrics.filter((e) => !metrics.has(e))
            : this.enabledMetrics.concat(Array.from(metrics));

        this.setEnabledMetrics(enabledMetrics);
    }

    public update(newValue: ISettings) {
        this.value = newValue;
        const allMetricsToCreate = new Set(this.value.enabledMetrics.map((m) => `${m.type}:${m.notebook}`));
        const allCreatedMetrics = this.allMetrics.map((m) => `${m.type}:${m.notebook}`);
        allMetricsToCreate.forEach((m) => {
            if (!allCreatedMetrics.includes(m)) {
                const [type, notebook] = m.split(':');
                const metric =
                    type === 'cpu' ? new KernelCpuMetric('cpu', notebook) : new KernelMemoryMetric('memory', notebook);
                metric.reset(this.value.viewDuration, this.value.pollInterval);
                this.allMetrics.push(metric);
                // Ensure we have the same number of empty metrics as we do in the system cpu (thats the base metric).
                this.allMetrics[0].metrics.forEach((_, i) => {
                    const time = metric.valueAt(i)?.time ?? 0;
                    if (!time) {
                        return;
                    }
                    const data: IDAMetrics = {
                        notebook,
                        timestamp: time,
                        cpu: { kernel: 0, system: 0 },
                        memory: { kernel: 0, system: 0, total: 0 }
                    };
                    metric.update(time, data);
                });
            }
        });

        // Remove items that are no longer valid.
        const invalidMetrics = this.allMetrics.filter(
            (m) => m.notebook && !this.value.monitoringNotebooks.includes(m.notebook)
        );
        for (const m of invalidMetrics) {
            this.allMetrics.splice(this.allMetrics.indexOf(m), 1);
        }

        this.steps = getSteps(newValue);
        this.fireChange();
    }

    private fireChange() {
        for (const l of this.changeListeners) {
            l();
        }
    }
}
