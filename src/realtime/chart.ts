/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Metric } from './baseMetric';
import styles from './chart.css';
import { Configurator } from './configurator';
import { FrameCanvas, Sizing } from './frameCanvas';
import { durationFormat } from './metrics';
import { Settings } from './settings';

const naturalAspectRatio = 16 / 9;
const autoOpenAspectRatio = 4 / 3;
const autoCloseAspectRatio = (naturalAspectRatio + autoOpenAspectRatio) / 2;

const openToSideWidth = 250;
const openToSideMinSpace = 600;

export class Chart {
    private valElements: [Metric, { val: HTMLElement }][] = [];
    private configOpen = false;
    private configHadManualToggle = false;
    private hasAnyData = false;

    private readonly frameCanvas = new FrameCanvas('cpu', this.width, this.height / 2, this.settings);
    private readonly memoryFrameCanvas = new FrameCanvas('memory', this.width, this.height / 2, this.settings);
    private readonly elements = this.createElements();
    private readonly settingListener = this.settings.onChange(() => this.applySettings());
    private readonly configurator = new Configurator(this.settings);

    public get elem() {
        return this.elements.container;
    }

    constructor(
        private width: number,
        private height: number,
        private readonly settings: Settings
    ) {
        this.setConfiguratorOpen(width / height < autoOpenAspectRatio);
        this.applySettings();
        this.frameCanvas.onHoverIndex = () => this.updateValueElements();
        this.memoryFrameCanvas.onHoverIndex = () => this.updateValueElements();
        this.frameCanvas.elem.addEventListener('mousemove', (evt) => {
            this.frameCanvas.onMouseMove(evt.pageX);
            this.memoryFrameCanvas.onMouseMove(evt.pageX);
        });
        this.memoryFrameCanvas.elem.addEventListener('mousemove', (evt) => {
            this.frameCanvas.onMouseMove(evt.pageX);
            this.memoryFrameCanvas.onMouseMove(evt.pageX);
        });
        this.frameCanvas.elem.addEventListener('mouseout', () => {
            this.frameCanvas.clearHover();
            this.memoryFrameCanvas.clearHover();
        });
        this.memoryFrameCanvas.elem.addEventListener('mouseout', () => {
            this.frameCanvas.clearHover();
            this.memoryFrameCanvas.clearHover();
        });
        window.addEventListener('mouseout', () => {
            this.frameCanvas.clearHover();
            this.memoryFrameCanvas.clearHover();
        });
    }

    public dispose() {
        this.settingListener();
        this.frameCanvas.dispose();
        this.memoryFrameCanvas.dispose();
    }

    /**
     * Update the size of the displayed chart.
     */
    public updateSize(width: number, height: number) {
        if (!this.configHadManualToggle) {
            const ratio = width / height;
            if (ratio < autoOpenAspectRatio) {
                this.setConfiguratorOpen(true);
            } else if (ratio > autoCloseAspectRatio) {
                this.setConfiguratorOpen(false);
            }
        }

        this.width = width;
        this.height = height;

        let graphHeight: number;
        let graphWidth: number;
        if (!this.configOpen) {
            graphHeight = height - Sizing.LabelHeight;
            graphWidth = width;
        } else if (width < openToSideMinSpace) {
            const cfgrect = this.configurator.elem.getBoundingClientRect();
            graphHeight = height - cfgrect.height;
            graphWidth = width;
        } else {
            graphHeight = height;
            graphWidth = width - openToSideWidth;
        }
        this.frameCanvas.updateSize(graphWidth, graphHeight / 2);
        this.memoryFrameCanvas.updateSize(graphWidth, graphHeight / 2);
    }

    /**
     * Update the chart metrics
     */
    public updateMetrics() {
        const { allMetrics, enabledMetrics } = this.settings;
        if (!this.hasAnyData) {
            const enabled = enabledMetrics.filter((m) => m.hasData());
            this.settings.setEnabledMetrics(enabled.length ? enabled : allMetrics);
        }

        this.configurator.updateMetrics();
        this.frameCanvas.updateMetrics();
        this.memoryFrameCanvas.updateMetrics();
        if (!this.frameCanvas.hoveredIndex && !this.memoryFrameCanvas.hoveredIndex) {
            this.updateValueElements();
        }

        this.setHasData(this.settings.allMetrics.some((m) => m.hasData()));
    }
    private getMatchingMetric(metric: Metric) {
        return this.settings.enabledMetrics.find(
            (m) => m !== metric && m.type && m.type !== metric.type && m.notebook === metric.notebook
        );
    }

    private updateMetric(metric: Metric, val: HTMLElement, hoveredTime: number = -1) {
        const matchingMetric = this.getMatchingMetric(metric);
        if (hoveredTime === -1) {
            this.configurator.updateMetric(
                val,
                { metric, value: metric.current },
                { metric: matchingMetric, value: matchingMetric?.current }
            );
        } else {
            const value = metric.valueAtTime(hoveredTime) ?? metric.current;
            this.configurator.updateMetric(
                val,
                { metric, value: value },
                {
                    metric: matchingMetric,
                    value: matchingMetric?.valueAtTime(hoveredTime) ?? matchingMetric?.current
                }
            );
        }
    }
    private updateValueElements() {
        for (const [metric, { val }] of this.valElements) {
            this.updateMetric(metric, val, this.frameCanvas.hoveredTime ?? this.memoryFrameCanvas.hoveredTime ?? -1);
        }
    }

    private setHasData(hasData: boolean) {
        if (hasData === this.hasAnyData) {
            return;
        }

        this.hasAnyData = hasData;
        this.elements.container.classList[hasData ? 'remove' : 'add'](styles.noData);
    }

    private setConfiguratorOpen(isOpen: boolean) {
        if (isOpen === this.configOpen) {
            return;
        }

        this.configOpen = isOpen;
        if (isOpen) {
            this.elem.appendChild(this.configurator.elem);
            this.elem.removeChild(this.elements.labelList);
            document.body.style.overflowY = 'auto';
            this.elements.container.classList.add(styles.configOpen);
        } else {
            this.elem.removeChild(this.configurator.elem);
            this.elem.appendChild(this.elements.labelList);
            document.body.style.overflowY = 'hidden';
            this.elements.container.classList.remove(styles.configOpen);
        }
    }

    private createElements() {
        const container = document.createElement('div');
        container.classList.add(styles.container, styles.noData);

        const graph = document.createElement('div');
        graph.style.position = 'relative';
        graph.appendChild(this.frameCanvas.elem);
        graph.appendChild(this.memoryFrameCanvas.elem);
        graph.addEventListener('click', () => this.toggleConfiguration(false));
        container.appendChild(graph);

        const noData = document.createElement('div');
        noData.classList.add(styles.noDataText);
        noData.innerHTML = 'No data available yet';
        container.appendChild(noData);

        const labelList = document.createElement('div');
        labelList.classList.add(styles.labelList);
        labelList.style.height = `${Sizing.LabelHeight}px`;
        labelList.addEventListener('click', () => this.toggleConfiguration(true));
        container.appendChild(labelList);

        const leftTime = document.createElement('div');
        leftTime.classList.add(styles.timeLeft);
        graph.appendChild(leftTime);

        const rightTime = document.createElement('div');
        rightTime.innerText = 'now';
        rightTime.classList.add(styles.timeRight);
        graph.appendChild(rightTime);

        const valueContainer = document.createElement('div');
        valueContainer.classList.add(styles.maxContainer);
        graph.appendChild(valueContainer);

        this.setSeries(labelList, valueContainer);

        return { container, labelList, leftTime, valueContainer };
    }

    private toggleConfiguration(toState = !this.configOpen) {
        if (toState === this.configOpen) {
            return;
        }

        this.configHadManualToggle = true;
        this.setConfiguratorOpen(toState);
        this.updateSize(this.width, this.height);
    }

    private applySettings() {
        const { leftTime, labelList, valueContainer } = this.elements;
        leftTime.innerText = `${durationFormat(this.settings.value.viewDuration / 1000)} ago`;
        this.setSeries(labelList, valueContainer);
        this.updateSize(this.width, this.height);
        if (this.settings.value.showCpu) {
            this.frameCanvas.elem.style.display = '';
        } else {
            this.frameCanvas.elem.style.display = 'none';
        }
        if (this.settings.value.showMemory) {
            this.memoryFrameCanvas.elem.style.display = '';
        } else {
            this.memoryFrameCanvas.elem.style.display = 'none';
        }
    }

    private setSeries(labelList: HTMLElement, maxContainer: HTMLElement) {
        for (const [, { val }] of this.valElements) {
            val.parentElement?.removeChild(val);
        }

        const split = 'remove';
        maxContainer.classList[split ? 'add' : 'remove'](styles.split);
        labelList.innerHTML = '';
        maxContainer.innerHTML = '';
        this.valElements = [];

        if (this.settings.value.showCpu || this.settings.value.showMemory) {
            const cpu = this.settings.value.showCpu ? { name: 'CPU', position: '0%' } : undefined;
            const memory =
                this.settings.value.showMemory && this.settings.value.showCpu
                    ? { name: 'Memory', position: '50%' }
                    : this.settings.value.showMemory && !this.settings.value.showCpu
                      ? { name: 'Memory', position: '0%' }
                      : undefined;

            [...(cpu ? [cpu] : []), ...(memory ? [memory] : [])].forEach(({ name, position }) => {
                const maxWrapper = document.createElement('div');
                maxWrapper.classList.add(styles.max);
                maxWrapper.style.top = position;
                const maxLabel = document.createElement('span');
                maxWrapper.classList.add(styles.maxLabel);
                maxLabel.innerText = name;
                maxWrapper.appendChild(maxLabel);
                maxContainer.appendChild(maxWrapper);
            });
        }

        for (let i = 0; i < this.settings.enabledMetrics.length; i++) {
            const metric = this.settings.enabledMetrics[i];
            if (metric.notebook && metric.type === 'memory') {
                // If this is the memory metric, then ignore this,
                // as we only display the cpu metric in the UI (as both cpu and memory labels are collapsed into one).
                continue;
            }
            const label = document.createElement('span');
            label.style.setProperty('--metric-color', this.settings.metricColor(metric));
            label.classList.add(styles.primary);
            label.innerText = `${metric.name()}: `;
            labelList.appendChild(label);

            const val = document.createElement('span');
            val.innerText = metric.format(metric.current);
            label.appendChild(val);

            this.valElements.push([metric, { val }]);
        }
    }
}
