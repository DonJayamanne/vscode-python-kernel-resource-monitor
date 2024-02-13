/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { window } from 'vscode';

export const logger = window.createOutputChannel('Python Performance Monitor', { log: true });
