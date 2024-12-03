// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import WebSocket from 'ws';

declare global {
    interface WebSocket {
        readyState: number;
        CLOSED: number;
        CONNECTING: number;
        OPEN: number;
        onmessage: (event: any) => void;
        onerror: (event: any) => void;
        onclose: () => void;
        onopen: () => void;
        send(data: string): void;
        close(): void;
    }
    var WebSocket: {
        new (url: string): WebSocket;
        readonly CLOSED: number;
        readonly CONNECTING: number;
        readonly OPEN: number;
    };
}

interface Project {
    project: string;
    file: string;
	line: number;
}

interface ResFocus {
    project: Project;
    find_flag: boolean;
}

interface WebSocketErrorEvent {
    error: Error;
    message: string;
    type: string;
}

let wsConnection: WebSocket | null = null;
let outputChannel: vscode.OutputChannel;

async function handleFocusData(data: ResFocus, currentWorkspace: vscode.WorkspaceFolder) {
    if (data.find_flag && data.project) {
        // 检查当前项目名称是否匹配
        if (currentWorkspace.name === data.project.project) {
            // 构建文件的完整路径
            const filePath = data.project.file;
            
            // 打开文件
            const document = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(document);
            
            // 跳转到指定行号
            if (data.project.line) {
                const line = data.project.line - 1; // VSCode的行号从0开始
                const range = editor.document.lineAt(line).range;
                editor.selection = new vscode.Selection(range.start, range.start);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
        }
    }
}

// 新增 WebSocket 连接创建函数
async function createWebSocketConnection(workspaceName: string) {
    if (!wsConnection || wsConnection.readyState === WebSocket.CLOSED) {
        try {
            outputChannel.appendLine(`Attempting to connect WebSocket for workspace: ${workspaceName}`);
            
            wsConnection = new WebSocket(
                `ws://localhost:8989/ws?project=${workspaceName}`
            );

            // 添加心跳检测
            let pingInterval: NodeJS.Timeout;
            
            wsConnection.onopen = () => {
                outputChannel.appendLine('WebSocket connection established successfully');
                vscode.window.showInformationMessage('Focus: WebSocket connected');
                
                // 设置30秒的心跳间隔
                pingInterval = setInterval(() => {
                    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                        try {
                            wsConnection.send(JSON.stringify({ type: 'ping' }));
                            outputChannel.appendLine('Ping sent to server');
                        } catch (error) {
                            outputChannel.appendLine(`Failed to send ping: ${error}`);
                        }
                    }
                }, 30000);
            };

            wsConnection.onmessage = async (event: WebSocket.MessageEvent) => {
                try {
                    if (!event.data) {
                        outputChannel.appendLine('Received empty WebSocket message');
                        return;
                    }

                    // 如果是 pong 消息，则只记录日志
                    if (typeof event.data === 'string') {
                        try {
                            const parsedData = JSON.parse(event.data);
                            if (parsedData.type === 'pong') {
                                outputChannel.appendLine('Received pong from server');
                                return;
                            }
                        } catch (e) {
                            // 解析失败，按普通消息处理
                        }
                    }

                    outputChannel.appendLine('Received WebSocket data: ' + event.data);
                    
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) {
                        return;
                    }
                    const currentWorkspace = workspaceFolders[0];
                    const data: ResFocus = JSON.parse(event.data.toString());
                    await handleFocusData(data, currentWorkspace);
                } catch (error) {
                    outputChannel.appendLine('Error processing WebSocket message: ' + JSON.stringify({
                        error,
                        rawData: event.data,
                        dataType: typeof event.data
                    }));
                    vscode.window.showErrorMessage(`Focus extension error: ${error}`);
                }
            };

            wsConnection.onerror = (error: WebSocketErrorEvent) => {
                const errorMessage = `WebSocket error: ${error.message || 'Unknown error'}`;
                outputChannel.appendLine(errorMessage);
                outputChannel.appendLine(`Error details: ${JSON.stringify(error, null, 2)}`);
                vscode.window.showErrorMessage(`Focus: ${errorMessage}`);
            };

            wsConnection.onclose = () => {
                outputChannel.appendLine('WebSocket connection closed');
                clearInterval(pingInterval); // 清除心跳定时器
                wsConnection = null;
                
                // 实现重连逻辑
                const retryDelay = 5000;
                outputChannel.appendLine(`Will attempt to reconnect in ${retryDelay/1000} seconds...`);
                
                setTimeout(() => {
                    if (vscode.workspace.workspaceFolders) {
                        outputChannel.appendLine('Attempting to reconnect...');
                        createWebSocketConnection(vscode.workspace.workspaceFolders[0].name)
                            .catch(err => {
                                outputChannel.appendLine(`Reconnection failed: ${err.message}`);
                            });
                    }
                }, retryDelay);
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            outputChannel.appendLine(`Failed to create WebSocket connection: ${errorMessage}`);
            vscode.window.showErrorMessage(`Focus: Failed to create WebSocket connection - ${errorMessage}`);
            throw error;
        }
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // 创建输出通道
    outputChannel = vscode.window.createOutputChannel('Focus Extension');
    
    // 将原来的 console.log 改为使用 outputChannel
    outputChannel.appendLine('Focus extension is now active!');

	// 在激活时检查并创建 WebSocket 连接
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		const currentWorkspace = workspaceFolders[0];
		const config = vscode.workspace.getConfiguration('focus');
		const mode = config.get<string>('mode', 'http');

		if (mode === 'websocket') {
			createWebSocketConnection(currentWorkspace.name);
		}
	}

	let disposable = vscode.window.onDidChangeWindowState(async (e) => {
		if (e.focused) {
			try {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders) {
					return;
				}

				const currentWorkspace = workspaceFolders[0];
				const config = vscode.workspace.getConfiguration('focus');
				const mode = config.get<string>('mode', 'http');

				if (mode === 'http') {
					// HTTP 模式
					const response = await axios.get<ResFocus>(
						`http://localhost:8989/focus?project=${currentWorkspace.name}`
					);
					await handleFocusData(response.data, currentWorkspace);
				}
			} catch (error) {
				console.error('Error in focus extension:', error);
				vscode.window.showErrorMessage('Focus extension error: ' + error);
			}
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (wsConnection) {
		wsConnection.close();
		wsConnection = null;
	}
	// 处理输出通道的清理
	if (outputChannel) {
		outputChannel.dispose();
	}
}
