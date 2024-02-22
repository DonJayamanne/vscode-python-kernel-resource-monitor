import { CancellationToken, NotebookDocument, extensions } from 'vscode';
import { Jupyter, Kernel } from '@vscode/jupyter-extension';

export async function getJupyterApi(): Promise<Jupyter> {
    const extension = extensions.getExtension<Jupyter>('ms-toolsai.jupyter');
    if (!extension) {
        throw new Error('Jupyter extension is not installed');
    }
    if (!extension.isActive) {
        await extension.activate();
    }
    return extension.exports;
}
export async function getPythonKernel(notebook: NotebookDocument): Promise<Kernel | undefined> {
    const api = await getJupyterApi();
    const kernel = await api.kernels.getKernel(notebook.uri);
    if (kernel?.language?.toLowerCase() !== 'python') {
        return;
    }

    return kernel;
}

export type ProcessInfo = {
    executable: string;
    env: Record<string, string>;
    pid: number;
};

const mime = 'application/vnd.jupyter.monitoring+json';
const code = `
def __resource_monitor_get_kernel_process_info():
    import sys
    import os
    import IPython.display


    display({"${mime}": {"executable": sys.executable, "env": dict(os.environ), "pid": os.getpid()}}, raw=True)


__resource_monitor_get_kernel_process_info()
del __resource_monitor_get_kernel_process_info    
`;
export async function getKernelProcessInfo(kernel: Kernel, token: CancellationToken) {
    for await (const output of kernel.executeCode(code, token)) {
        const infoItem = output.items.find((i) => i.mime === mime);
        if (infoItem) {
            return JSON.parse(new TextDecoder().decode(infoItem.data)) as ProcessInfo;
        }
        continue;
    }
    return;
}
