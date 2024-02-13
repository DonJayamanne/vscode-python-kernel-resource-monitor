/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { RealtimeNotebookKernelMonitor } from './notebookKernelMonitor';
import { startCapturingCpuUsage } from './python/performanceMonitor.node';
import { RealtimeWebviewProvider } from './realtimeWebviewProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(startCapturingCpuUsage());
    const realtimeTracker = new RealtimeNotebookKernelMonitor(context);
    const realtime = new RealtimeWebviewProvider(context.extensionUri, realtimeTracker);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(RealtimeWebviewProvider.viewType, realtime),

        // vscode.workspace.onDidChangeConfiguration((evt) => {
        //     if (allConfig.some((c) => evt.affectsConfiguration(c))) {
        //         realtimeTracker.updateSettings();
        //     }
        // }),

        vscode.workspace.onDidOpenNotebookDocument((e) => realtimeTracker.startTracking(e)),
        vscode.window.onDidChangeActiveNotebookEditor((e) => e?.notebook && realtimeTracker.startTracking(e.notebook)),
        vscode.workspace.onDidCloseNotebookDocument((e) => realtimeTracker.stopTracking(e)),
        vscode.commands.registerCommand('vscode-python-kernel-resource-monitor.toggle.cpu', async () => {
            realtimeTracker.toggleCPU();
        }),
        vscode.commands.registerCommand('vscode-python-kernel-resource-monitor.toggle.memory', async () => {
            realtimeTracker.toggleMemory();
        })
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
    // noop
}
