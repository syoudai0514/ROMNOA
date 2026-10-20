import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal-error">
          <img src="/icon.svg" width="64" alt="ロムノア" />
          <h1>画面を開けませんでした</h1>
          <p>再読み込みしてお試しください。保存データは削除されません。</p>
          <button onClick={() => location.reload()}>再読み込み</button>
        </main>
      );
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
