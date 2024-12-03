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
        onmessage: (event: any) => void;
        onerror: (event: any) => void;
        onclose: () => void;
        close(): void;
    }
    var WebSocket: {
        new (url: string): WebSocket;
        readonly CLOSED: number;
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

let wsConnection: WebSocket | null = null;

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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Focus extension is now active!');

	// 注册窗口状态变化事件
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

				if (mode === 'websocket') {
					// WebSocket 模式
					if (!wsConnection || wsConnection.readyState === WebSocket.CLOSED) {
						wsConnection = new WebSocket(
							`ws://localhost:8989/ws?project=${currentWorkspace.name}`
						);

						wsConnection.onmessage = async (event: WebSocket.MessageEvent) => {
							try {
								// 添加日志来查看接收到的原始数据
								console.log('Received WebSocket data:', event.data);
								
								// 确保数据不为空
								if (!event.data) {
									console.error('Received empty WebSocket message');
									return;
								}

								const data: ResFocus = JSON.parse(event.data.toString());
								await handleFocusData(data, currentWorkspace);
							} catch (error) {
								// 更详细的错误日志
								console.error('Error processing WebSocket message:', {
									error,
									rawData: event.data,
									dataType: typeof event.data
								});
								vscode.window.showErrorMessage(`Focus extension error: ${error}`);
							}
						};

						wsConnection.onerror = (error: WebSocket.ErrorEvent) => {
							console.error('WebSocket error:', error);
							vscode.window.showErrorMessage('WebSocket connection error');
						};

						wsConnection.onclose = () => {
							console.log('WebSocket connection closed');
						};
					}
				} else {
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
}
