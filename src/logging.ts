import { window } from 'vscode';

export const logger = window.createOutputChannel('Python Performance Monitor', { log: true });
