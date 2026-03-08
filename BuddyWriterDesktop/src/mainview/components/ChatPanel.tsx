import { useEffect, useRef, useState } from "react";
import { rpcClient } from "../rpc/client";

export type ChatPanelMessage = {
	id: string;
	rawText: string;
	role: "user" | "assistant";
	showApply: boolean;
};

type ChatPanelProps = {
	canSpeakAssistantText: boolean;
	hasContext: boolean;
	markdownMode: boolean;
	messages: ChatPanelMessage[];
	onApplyToSelection: (text: string) => void;
	onClearContext: () => void;
	onClose: () => void;
	onSend: (message: string) => Promise<void>;
	onSpeakAssistantText: (text: string) => Promise<void>;
	open: boolean;
};

type AssistantBubbleProps = {
	canSpeakAssistantText: boolean;
	markdownMode: boolean;
	message: ChatPanelMessage;
	onApplyToSelection: (text: string) => void;
	onSpeakAssistantText: (text: string) => Promise<void>;
};

function AssistantBubble(props: AssistantBubbleProps): React.ReactElement {
	const { canSpeakAssistantText, markdownMode, message, onApplyToSelection, onSpeakAssistantText } = props;
	const [html, setHtml] = useState("");

	useEffect(() => {
		if (!markdownMode) {
			setHtml("");
			return;
		}

		let cancelled = false;
		void rpcClient.renderMarkdown({ text: message.rawText }).then((result) => {
			if (!cancelled) {
				setHtml(result.html);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [markdownMode, message.rawText]);

	return (
		<div className={`chat-msg assistant ${markdownMode ? "" : "plain-text"}`.trim()}>
			{markdownMode && html ? (
				<div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
			) : (
				message.rawText
			)}
			{message.showApply || canSpeakAssistantText ? (
				<div className="chat-msg-actions">
					{message.showApply ? (
						<button type="button" className="apply-btn" onClick={() => onApplyToSelection(message.rawText)}>
							↳ Apply to selection
						</button>
					) : null}
					{canSpeakAssistantText ? (
						<button type="button" className="apply-btn" onClick={() => void onSpeakAssistantText(message.rawText)}>
							Read aloud
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function ChatPanel(props: ChatPanelProps): React.ReactElement {
	const {
		canSpeakAssistantText,
		hasContext,
		markdownMode,
		messages,
		onApplyToSelection,
		onClearContext,
		onClose,
		onSend,
		onSpeakAssistantText,
		open,
	} = props;
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (open) {
			inputRef.current?.focus();
		}
	}, [open]);

	useEffect(() => {
		if (messagesRef.current) {
			messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
		}
	}, [messages]);

	function sendMessage(): void {
		const message = input.trim();
		if (!message) return;
		setInput("");
		void onSend(message);
	}

	return (
		<div className={`chat-panel ${open ? "open" : ""}`}>
			<div className="chat-header electrobun-webkit-app-region-drag">
				<span className="chat-title">Assistant</span>
				<button type="button" className="chat-close" onClick={onClose}>
					&times;
				</button>
			</div>
			<div ref={messagesRef} className="chat-messages">
				{messages.map((message) => (
					message.role === "assistant" ? (
						<AssistantBubble
							key={message.id}
							canSpeakAssistantText={canSpeakAssistantText}
							markdownMode={markdownMode}
							message={message}
							onApplyToSelection={onApplyToSelection}
							onSpeakAssistantText={onSpeakAssistantText}
						/>
					) : (
						<div key={message.id} className="chat-msg user">
							{message.rawText}
						</div>
					)
				))}
			</div>
			<div className="chat-input-area">
				{hasContext ? (
					<div className="chat-context">
						<span className="chat-context-label">Selected text</span>
						<button type="button" className="clear-context" onClick={onClearContext}>
							&times;
						</button>
					</div>
				) : null}
				<textarea
					ref={inputRef}
					className="chat-input"
					placeholder="Ask AI to help with your writing..."
					rows={2}
					value={input}
					onChange={(event) => {
						setInput(event.currentTarget.value);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							sendMessage();
						}
					}}
				/>
				<button type="button" className="chat-send" onClick={sendMessage}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M22 2L11 13" />
						<path d="M22 2L15 22L11 13L2 9L22 2Z" />
					</svg>
				</button>
			</div>
		</div>
	);
}
