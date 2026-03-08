type StatusBarProps = {
	aiStatus: string;
	wordCount: number;
};

export function StatusBar(props: StatusBarProps): React.ReactElement {
	const { aiStatus, wordCount } = props;
	return (
		<div className="status-bar">
			<span>{`${wordCount} word${wordCount !== 1 ? "s" : ""}`}</span>
			<span className={aiStatus ? "visible" : ""}>{aiStatus}</span>
		</div>
	);
}
