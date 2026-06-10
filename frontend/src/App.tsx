import { MvpFlow } from './features/mvp-flow/MvpFlow'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>Reffo MVP - AI 简历优化工具</h1>
        <p>基于 AI Agent 的智能简历优化服务</p>
      </header>

      <main className="container">
        <MvpFlow />
      </main>

      <footer className="footer">
        <p>Reffo MVP v0.1.0 | 技术栈：React + TypeScript + Elysia + DeepSeek</p>
      </footer>
    </div>
  )
}

export default App
