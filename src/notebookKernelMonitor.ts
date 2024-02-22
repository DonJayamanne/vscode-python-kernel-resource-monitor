import * as vscode from 'vscode';
import { logger } from './logging';
import {
    PerformanceMonitor,
    getHostCpuMemoryInfo,
    getOrCreatePerformanceMonitor,
    getPerformanceMonitor,
    isAnyNotebookBeingMonitored
} from './python/performanceMonitor.node';
import { IDAMetrics, ISettings, MessageType, ToWebViewMessage } from './realtime/protocol';

export function isJupyterNotebook(document: vscode.NotebookDocument) {
    return document.notebookType === 'jupyter-notebook' || document.notebookType === 'interactive';
}
export const readRealtimeSettings = (context: vscode.ExtensionContext): ISettings => {
    const config = vscode.workspace.getConfiguration();
    return {
        easing: vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.HighContrast,
        // easing: config.get(Config.Easing) ?? vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.HighContrast,
        enabledMetrics: [{ type: 'cpu', notebook: '' }], // By default, display System CPU.
        monitoringNotebooks: [],
        pollInterval: 1 * 1000,
        // pollInterval: config.get(Config.PollInterval, 1) * 1000,
        // viewDuration: config.get(Config.ViewDuration, 30) * 1000,
        viewDuration: 30 * 1000,
        showCpu: context.workspaceState.get<boolean>(showCPU, true),
        showMemory: context.workspaceState.get<boolean>(showMemory, true),
        zoomLevel: config.get('window.zoomLevel', 0)
    };
};

const showCPU = 'showCPU';
const showMemory = 'showMemory';

export class RealtimeNotebookKernelMonitor {
    private settings = readRealtimeSettings(this.context);
    private webviews = new Set<vscode.WebviewView>();
    private disposables: vscode.Disposable[] = [];

    /**
     * Returns any realtime metric webviews that are currently visible.
     */
    public get visibleWebviews() {
        return [...this.webviews].filter((w) => w.visible);
    }

    constructor(private readonly context: vscode.ExtensionContext) {
        this.sendSystemCPUDataEverySecond();
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    /**
     * Updates the metrics enabled in the displayed chart.
     */
    public setEnabledMetrics(enabled: { type: 'cpu' | 'memory'; notebook: string }[]) {
        this.settings.enabledMetrics = enabled;
        this.updateSettings();
    }

    public toggleCPU() {
        this.settings.showCpu = !this.settings.showCpu;
        this.context.workspaceState.update(showCPU, this.settings.showCpu);
        this.updateSettings();
    }
    public toggleMemory() {
        this.settings.showMemory = !this.settings.showMemory;
        this.context.workspaceState.update(showMemory, this.settings.showMemory);
        this.updateSettings();
    }

    /**
     * Adds a webview to the session tracking.
     */
    public trackWebview(webview: vscode.WebviewView) {
        this.webviews.add(webview);

        this.disposables.push(
            webview.onDidChangeVisibility(() => {
                if (webview.visible) {
                    this.hydrate();
                } else {
                    // Shut down all the perf monitors, leave it running only when active.
                    vscode.workspace.notebookDocuments.forEach((n) => this.stopTracking(n));
                }
            }),

            webview.onDidDispose(() => {
                this.webviews.delete(webview);
            })
        );

        this.hydrate();
    }

    public stopTracking(notebook: vscode.NotebookDocument) {
        if (!isJupyterNotebook(notebook)) {
            return;
        }

        getPerformanceMonitor(notebook)?.dispose();
        const notebookPath = notebook.uri.fsPath;
        if (this.settings.monitoringNotebooks.includes(notebookPath)) {
            this.settings.monitoringNotebooks = this.settings.monitoringNotebooks.filter((n) => n !== notebookPath);
            this.settings.enabledMetrics = this.settings.enabledMetrics.filter((m) => m.notebook !== notebookPath);
            this.updateSettings();
        }
    }

    /**
     * Should be called when settings update.
     */
    public updateSettings() {
        this.settings = this.settings || readRealtimeSettings(this.context);
        this.broadcast({ type: MessageType.UpdateSettings, settings: this.settings });
    }
    private updateSettingsIfMonitoringANewNotebook(monitor: PerformanceMonitor) {
        if (monitor.status !== 'started' || !monitor.notebook) {
            return;
        }
        const notebookPath = monitor.notebook.uri.fsPath;
        if (this.settings.monitoringNotebooks.includes(notebookPath)) {
            return;
        }
        this.settings.monitoringNotebooks.push(notebookPath);
        this.settings.enabledMetrics = this.settings.enabledMetrics.filter((m) => m.notebook !== notebookPath);
        this.settings.enabledMetrics.push({ type: 'cpu', notebook: notebookPath });
        this.settings.enabledMetrics.push({ type: 'memory', notebook: notebookPath });
        this.updateSettings();
    }
    private monitoredItems = new WeakSet<PerformanceMonitor>();
    private hookupPerfData(monitor: PerformanceMonitor) {
        if (this.monitoredItems.has(monitor)) {
            return;
        }
        this.monitoredItems.add(monitor);
        this.disposables.push(
            monitor.onPerfData((e) => {
                this.updateSettingsIfMonitoringANewNotebook(monitor);
                this.dataToSend.push(e.data);
            })
        );
    }
    private dataToSend: IDAMetrics[] = [];
    private sendSystemCPUDataEverySecond() {
        let lastSeenTime = 0;
        const interval = setInterval(() => {
            const data = this.dataToSend;
            this.dataToSend = [];
            const delayTime = isAnyNotebookBeingMonitored() ? 1000 : 0;
            const timeAccurateToSeconds = Math.floor(Date.now() / 1000) * 1000;
            const shouldSendDummyData = data.length === 0 && timeAccurateToSeconds - lastSeenTime >= delayTime;
            if (!shouldSendDummyData) {
                lastSeenTime = timeAccurateToSeconds;
            }
            if (!shouldSendDummyData && data.length === 0) {
                return;
            }
            if (shouldSendDummyData) {
                // Lets not have an idle chart, display something every 5s.
                const hostInfo = getHostCpuMemoryInfo();
                const metrics: IDAMetrics = {
                    notebook: '',
                    // Send data accurate to the second.
                    // Also remember the data is 1s old.
                    timestamp: Math.floor(Date.now() / 1000) * 1000 - 1000,
                    cpu: { system: hostInfo.cpuPercent / 100, kernel: 0 },
                    memory: {
                        kernel: 0,
                        system: hostInfo.totalMemory - hostInfo.freeMemory,
                        total: hostInfo.totalMemory
                    }
                };
                data.push(metrics);
            }
            // If there are notebooks we were monitoring,
            // and we haven't got the data, then fill in with the old values.
            const notebooks = new Set(data.map((d) => d.notebook));
            const times = data.map((d) => d.timestamp);
            for (const notebook of vscode.workspace.notebookDocuments) {
                if (
                    !isJupyterNotebook(notebook) ||
                    !this.settings.monitoringNotebooks.includes(notebook.uri.fsPath) ||
                    notebooks.has(notebook.uri.fsPath)
                ) {
                    continue;
                }
                const monitor = getPerformanceMonitor(notebook);
                if (!monitor) {
                    continue;
                }
                const metrics = times.map((t) => {
                    return {
                        notebook: notebook.uri.fsPath,
                        timestamp: t,
                        cpu: { system: 0, kernel: monitor.lastCpuPercent },
                        memory: { kernel: monitor.lastMemory, system: 0, total: 0 }
                    };
                });
                data.push(...metrics);
            }
            if (!data.length) {
                return;
            }
            this.broadcast({ type: MessageType.BatchAddData, data: data });
        }, 1_000);
        this.disposables.push({ dispose: () => clearInterval(interval) });
    }
    public async startTracking(notebook: vscode.NotebookDocument) {
        // If we haven't opened the webview, then no point monitoring any notebooks.
        if (!isJupyterNotebook(notebook) || this.webviews.size === 0) {
            return;
        }

        let monitor = getPerformanceMonitor(notebook);
        if (monitor) {
            void monitor.start();
        }
        try {
            monitor = await getOrCreatePerformanceMonitor(notebook, this.context);
            this.hookupPerfData(monitor);
        } catch (e) {
            logger.error(`Error starting performance monitor: ${e}`);
            return;
        }
    }

    private broadcast(message: ToWebViewMessage) {
        for (const webview of this.visibleWebviews) {
            webview.webview.postMessage(message);
        }
    }

    private hydrate() {
        vscode.workspace.notebookDocuments.forEach((n) => this.stopTracking(n));
        this.updateSettings();
    }
}
