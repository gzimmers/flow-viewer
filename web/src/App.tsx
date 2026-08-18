import { HashRouter, Route, Routes, useParams, Navigate } from 'react-router-dom'
import { Library } from './components/Library'
import { Workspace } from './components/Workspace'

function FlowRoute() {
  const { flowId } = useParams()
  return <Workspace key={flowId} flowId={flowId ?? ''} />
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/flow/:flowId" element={<FlowRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
