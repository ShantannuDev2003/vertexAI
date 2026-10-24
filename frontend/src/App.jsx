import React from 'react'

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import { useDispatch } from 'react-redux'
import { setUserData } from './redux/userSlice.js'
import { me } from './features/me.js'
import { useEffect } from 'react'
import ProjectPage from './pages/ProjectPage.jsx'
const App = () => {
  const dispatch = useDispatch()
  useEffect(() => {

    const fetchCurrentUser = async () => {

      try {

        const data = await me();

        dispatch(setUserData(data));

      } catch (error) {

        console.log("No active session");

      }

    };

    fetchCurrentUser();

  }, []);
  return (
    
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/project/:id" element={<ProjectPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
