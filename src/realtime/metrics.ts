/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Metric } from './baseMetric';
import { IDAMetrics } from './protocol';

const sizeLabels = ['B', 'KB', 'MB', 'GB', 'TB'];

const sizeInnerFormat = new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: 3
} as Intl.NumberFormatOptions);

const formatSize = (bytes: number) => {
    let size = 0;
    while (bytes > 1024 && size < sizeLabels.length) {
        bytes /= 1024;
        size++;
    }

    return `${sizeInnerFormat.format(bytes)} ${sizeLabels[size]}`;
};

// you can't mix sig fix and max fraction digits, so need both to avoid things like 0.0000012%
const largePercentFormat = new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumSignificantDigits: 2,
    maximumSignificantDigits: 2
});

const smallPercentFormat = new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 2
});

const durationRawFormat = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1
});

function getNotebookName(notebook: string = '') {
    // return '';
    notebook = notebook.replace(/\\/g, '/');
    if (!notebook || !notebook.includes('/')) {
        return '';
    }
    return notebook.split('/').pop();
}

export const durationFormat = (seconds: number) => {
    if (seconds < 120) {
        return `${durationRawFormat.format(seconds)}s`;
    }

    const minutes = seconds / 60;
    if (minutes < 120) {
        return `${durationRawFormat.format(minutes)}m`;
    }

    const hours = minutes / 60;
    return `${durationRawFormat.format(hours)}h`;
};

export class KernelCpuMetric extends Metric {
    public override get maxY() {
        return 1;
    }

    public update(timestamp: number, metrics: IDAMetrics): void {
        if (metrics.notebook && metrics.notebook !== this.notebook) {
            return;
        }
        if (metrics.cpu) {
            this.push(timestamp, metrics.cpu.kernel);
        }
    }

    public format(metric: number): string {
        metric = Math.max(0, Math.min(1, metric));
        return metric >= 0.01 ? largePercentFormat.format(metric) : smallPercentFormat.format(metric);
    }

    public name(): string {
        return getNotebookName(this.notebook) || `${getNotebookName(this.notebook)} CPU Usage`.trim();
    }

    public short(): string {
        return getNotebookName(this.notebook) || `${getNotebookName(this.notebook)} CPU`.trim();
    }

    protected recalcMax() {
        return 1;
    }
}

export class HostCpuMetric extends KernelCpuMetric {
    public update(timestamp: number, metrics: IDAMetrics): void {
        // if (metrics.notebook) {
        //     return;
        // }
        if (metrics.cpu?.system /* node */) {
            this.push(timestamp, metrics.cpu.system); // microseconds to s
        }
    }

    public name(): string {
        return 'System CPU Usage';
    }

    public short(): string {
        return 'System CPU';
    }
}

export class KernelMemoryMetric extends Metric {
    public update(timestamp: number, metrics: IDAMetrics): void {
        if (metrics.notebook && metrics.notebook !== this.notebook) {
            return;
        }
        if (metrics.memory /* node */) {
            this.push(timestamp, metrics.memory.kernel);
        }
    }

    public format(metric: number): string {
        return formatSize(metric);
    }

    public short(): string {
        return getNotebookName(this.notebook) || `${getNotebookName(this.notebook)} Memory`.trim();
    }

    public name(): string {
        return getNotebookName(this.notebook) || `${getNotebookName(this.notebook)} Memory Used`.trim();
    }
}

export class HostMemoryMetric extends KernelMemoryMetric {
    public update(timestamp: number, metrics: IDAMetrics): void {
        if (metrics.memory /* node */) {
            this.push(timestamp, metrics.memory.system);
        }
    }

    public short(): string {
        return 'System Memory';
    }

    public name(): string {
        return 'System Virtual Memory';
    }
}

export const createMetrics = () => [new HostCpuMetric('cpu')];
