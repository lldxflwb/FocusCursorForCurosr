// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';

interface Project {
    project: string;
    file: string;
	line: number;
}

interface ResFocus {
    project: Project;
    find_flag: boolean;
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
				// 获取当前工作区
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders) {
					return;
				}

				const currentWorkspace = workspaceFolders[0];
				
				// 发送请求到服务器
				const response = await axios.get<ResFocus>(
					`http://localhost:8989/focus?project=${currentWorkspace.name}`
				);
				const data = response.data;

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
			} catch (error) {
				console.error('Error in focus extension:', error);
				vscode.window.showErrorMessage('Focus extension error: ' + error);
			}
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
