import * as vscode from 'vscode';
import { makeNonce, nonceHeader } from './nonce';
import { RealtimeNotebookKernelMonitor } from './notebookKernelMonitor';
import { FromWebViewMessage, MessageType } from './realtime/protocol';

export class RealtimeWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'vscode-python-kernel-resource-monitor.realtime';
    private disposables: vscode.Disposable[] = [];
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly tracker: RealtimeNotebookKernelMonitor
    ) {}

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    /**
     * @inheritdoc
     */
    public resolveWebviewView(webviewView: vscode.WebviewView) {
        vscode.commands.executeCommand('setContext', 'vscode-python-kernel-resource-monitor:enabled', true);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        this.tracker.trackWebview(webviewView);
        this.disposables.push(
            webviewView.onDidChangeVisibility(() => {
                vscode.commands.executeCommand(
                    'setContext',
                    'vscode-python-kernel-resource-monitor:enabled',
                    webviewView.visible
                );
            }),
            webviewView.webview.onDidReceiveMessage((evt: FromWebViewMessage) => {
                switch (evt.type) {
                    case MessageType.SetEnabledMetrics:
                        this.tracker.setEnabledMetrics(evt.keys);
                        break;
                    default:
                    // ignored
                }
            })
        );
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'client.bundle.js'));
        const nonce = makeNonce();

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
        ${nonceHeader(nonce)}
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Kernel Resource Monitor</title>
			</head>
      <body>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
      </html>
    `;
    }
}
