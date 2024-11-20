import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import BlueSkyViz from './BlueSkyVis'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <BlueSkyViz />
    </>
  )
}

export default App
