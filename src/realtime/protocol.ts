/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export interface ISettings {
    enabledMetrics: { type: 'cpu' | 'memory'; notebook: string }[];
    monitoringNotebooks: string[];
    showCpu: boolean;
    showMemory: boolean;
    viewDuration: number;
    pollInterval: number;
    zoomLevel: number;
    easing: boolean;
}

export const enum MessageType {
    UpdateSettings,
    AddData,
    BatchAddData,
    SwitchGraph,
    SetEnabledMetrics,
    ApplyData,
    ClearData
}

interface Memory {
    kernel: number;
    system: number;
    total: number;
}
export interface IDAMetrics {
    notebook: string;
    timestamp: number;

    cpu?: { kernel: number; system: number };
    memory?: Memory;
}

export interface IAddData {
    type: MessageType.AddData;
    data: IDAMetrics;
}
export interface IBatchAddData {
    type: MessageType.BatchAddData;
    data: IDAMetrics[];
}

export interface IUpdateSettingsMessage {
    type: MessageType.UpdateSettings;
    settings: ISettings;
}

export interface ISwitchGraph {
    type: MessageType.SwitchGraph;
    side: 'left' | 'right';
    options: { name: string; key: number }[];
}

export interface ISetEnabledGraphs {
    type: MessageType.SetEnabledMetrics;
    keys: { type: 'cpu' | 'memory'; notebook: string }[];
}

export interface IApplyData {
    type: MessageType.ApplyData;
    title: string;
    data: number[][];
}

export interface IClearData {
    type: MessageType.ClearData;
}

export type ToWebViewMessage = IAddData | IUpdateSettingsMessage | IApplyData | IClearData | IBatchAddData;
export type FromWebViewMessage = ISwitchGraph | ISetEnabledGraphs;

export const getSteps = (settings: ISettings) => Math.ceil(settings.viewDuration / settings.pollInterval);
