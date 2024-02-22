import { ChildProcess, spawn } from 'child_process';
import * as nodeOSUtils from 'node-os-utils';
import * as os from 'os';
import {
    Disposable,
    CancellationTokenSource,
    EventEmitter,
    ExtensionContext,
    NotebookDocument,
    Uri,
    workspace
} from 'vscode';
import { logger } from '../logging';
import { getKernelProcessInfo, getPythonKernel } from './kernel';
import { Kernel } from '@vscode/jupyter-extension';
import { IDAMetrics } from '../realtime/protocol';

function getPythonFile(context: ExtensionContext) {
    return Uri.joinPath(context.extensionUri, 'python', 'process_monitor.py').fsPath;
}

const monitors = new WeakMap<NotebookDocument, PerformanceMonitor>();

let cpuNow = 0;
export function startCapturingCpuUsage() {
    const interval = setInterval(() => {
        nodeOSUtils.cpu.usage(1000).then((cpu) => {
            cpuNow = cpu;
        });
    });
    return new Disposable(() => clearInterval(interval));
}
export function getCurrentCpuPercent() {
    return cpuNow;
}

export function getHostCpuMemoryInfo() {
    return {
        cpuPercent: cpuNow,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem()
    };
}
export function isAnyNotebookBeingMonitored() {
    return workspace.notebookDocuments.some((doc) => monitors.has(doc));
}
export function getPerformanceMonitor(notebook: NotebookDocument) {
    return monitors.get(notebook);
}

export async function getOrCreatePerformanceMonitor(notebook: NotebookDocument, context: ExtensionContext) {
    let monitor = monitors.get(notebook);
    if (monitor) {
        void monitor.start();
        return monitor;
    }
    monitor = new PerformanceMonitor(notebook, getPythonFile(context));
    context.subscriptions.push(monitor);
    monitors.set(notebook, monitor);
    await monitor.start();
    return monitor;
}

export function shutdownMonitor(notebook: NotebookDocument) {
    monitors.get(notebook)?.dispose();
}

const separator = `852d303a-98f4-4384-a1a3-ebdace595f8c`;
interface PerfInfo {
    kernel_cpu: number;
    kernel_memory: number;
}

export class PerformanceMonitor {
    _onPerfData = new EventEmitter<{ notebook: NotebookDocument; data: IDAMetrics }>();
    public readonly onPerfData = this._onPerfData.event;
    private proc?: ChildProcess;
    private pid?: number;
    public readonly data: IDAMetrics[] = [];
    public lastCpuPercent = 0;
    public lastMemory = 0;
    private readonly monitoringKernels = new WeakSet<Kernel>();
    private _status: 'stopped' | 'starting' | 'started' = 'stopped';
    public get status() {
        return this._status;
    }
    private disposables: Disposable[] = [];
    public get notebook(): NotebookDocument | undefined {
        return this._notebook.deref();
    }
    private readonly _notebook: WeakRef<NotebookDocument>;
    constructor(
        notebook: NotebookDocument,
        private readonly pythonFile: string
    ) {
        this._notebook = new WeakRef(notebook);
        workspace.onDidChangeNotebookDocument(
            (e) => {
                if (e.notebook !== this.notebook) {
                    return;
                }
                this.start().finally(() => {
                    if (this.status !== 'started') {
                        // Possible there's a delay in getting the kernel from Jupyter
                        // Lets try again in a few seconds
                        // Or possible user has not started the kernel yet, but just editing.
                        // An event indicating a kernel has started would be ideal, this is a work around.
                        setTimeout(() => this.start(), 1000);
                        setTimeout(() => this.start(), 5000);
                    }
                });
            },
            undefined,
            this.disposables
        );
    }
    async start() {
        if (this.status === 'started') {
            return;
        }
        const notebook = this.notebook;
        if (!notebook) {
            return;
        }
        const kernel = await getPythonKernel(notebook);
        if (!kernel) {
            return;
        }
        await this.startMonitoringKernel(kernel);
        this.monitorKernel(kernel);
    }
    async startMonitoringKernel(kernel: Kernel) {
        if (this.status === 'started' || this.status === 'starting') {
            return;
        }
        this._status = 'starting';
        const token = new CancellationTokenSource();
        const processInfo = await getKernelProcessInfo(kernel, token.token);
        if (!processInfo) {
            this._status = 'stopped';
            return;
        }
        if (this.pid === processInfo.pid) {
            return;
        }
        this.pid = processInfo.pid;
        this.proc = spawn(processInfo.executable, [this.pythonFile], { env: processInfo.env });
        let output = '';
        this.proc.stdout?.on('data', (data) => {
            output += data.toString();
            const notebook = this.notebook;
            if (!notebook) {
                return;
            }
            if (output.includes(separator)) {
                output
                    .split(separator)
                    .map((item) => item.trim())
                    .filter((item) => item.length)
                    .map((item) => {
                        try {
                            return JSON.parse(item);
                        } catch {
                            return;
                        }
                    })
                    .filter((item) => !!item)
                    .map((item) => item as PerfInfo)
                    .forEach(async (data) => {
                        const hostInfo = getHostCpuMemoryInfo();
                        const kernelCpu = (this.lastCpuPercent = (data.kernel_cpu || 0) / 100);
                        const kernelMemory = (this.lastMemory = data.kernel_memory);
                        const metrics: IDAMetrics = {
                            notebook: notebook.uri.fsPath,
                            // Send data accurate to the second.
                            timestamp: Math.floor(Date.now() / 1000) * 1000,
                            cpu: { system: hostInfo.cpuPercent / 100, kernel: kernelCpu },
                            memory: {
                                kernel: kernelMemory,
                                system: hostInfo.totalMemory - hostInfo.freeMemory,
                                total: hostInfo.totalMemory
                            }
                        };
                        this.data.push(metrics);
                        if (this.data.length > 60) {
                            this.data.shift();
                        }
                        this._onPerfData.fire({ notebook, data: metrics });
                    });
            }
            output = output.substring(output.lastIndexOf(separator) + separator.length);
        });
        this.proc.stderr?.on('data', (data) => logger.error(`Error from performance monitor: ${data.toString()}`));
        this.proc.stdin?.write(`${JSON.stringify({ pid: processInfo.pid })}${os.EOL}`);
        this._status = 'started';
    }

    private monitorKernel(kernel: Kernel) {
        let gettingInfo = false;
        if (this.monitoringKernels.has(kernel)) {
            return;
        }
        this.monitoringKernels.add(kernel);
        kernel.onDidChangeStatus(
            async (e) => {
                if (
                    e === 'autorestarting' ||
                    e === 'restarting' ||
                    e === 'starting' ||
                    e === 'terminating' ||
                    e === 'dead'
                ) {
                    this.stop();
                }
                if (!gettingInfo && this.status === 'stopped' && (e === 'idle' || e === 'busy')) {
                    gettingInfo = true;
                    this.start().finally(() => (gettingInfo = false));
                }
            },
            this,
            this.disposables
        );
    }

    stop() {
        if (!this.proc) {
            return;
        }
        this.proc?.kill();
        this.proc = undefined;
        this._status = 'stopped';
    }
    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this._onPerfData.dispose();
        this.proc?.kill();
        this.proc = undefined;
    }
}
