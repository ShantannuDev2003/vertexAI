import React from "react";
import { FaGoogle } from "react-icons/fa";
import { auth, googleProvider } from "../../firebase.js";
import { signInWithPopup } from "firebase/auth";
import { login } from "../features/login.js";
import { useDispatch } from "react-redux";
import { setUserData } from "../redux/userSlice.js";
import { useSelector } from "react-redux";
import NavBar from "../components/NavBar.jsx";
import { Menu, Plus } from "lucide-react";
import SideBar from '../components/SideBar';
import { useState } from "react";
import { motion } from "motion/react";
import { setProjects} from '../redux/projectSlice';
import { getProjects ,getStarredProjects} from '../features/project';
import { X } from "lucide-react";
import { useEffect } from "react";
import { Loader2, Folder } from "lucide-react";
import CreateProjectModal from "../components/CreateProjectModal.jsx";
import ProjectCard from "../components/ProjectCard.jsx";



const Dashboard = () => {
    const [loading, setLoading] = React.useState(false);
    const dispatch = useDispatch();
    const { userData } = useSelector(state => state.user)
    const [mobileSideBarOpen, setMobileSidebarOpen] = useState(false)
    const [activeSession, setActiveSession] = useState("projects")
    const [loadingProjects, setLoadingProjects] = useState(false)
    const { projects, starredProjects } = useSelector(state => state.project)
    const [openModal, setOpenModal] = useState(false)


    const handleLogin = async () => {
        try {
            setLoading(true);

            const result =
                await signInWithPopup(
                    auth,
                    googleProvider
                );

            const token =
                await result.user.getIdToken();

            const data = await login(token);

            dispatch(setUserData(data));

        } catch (error) {
            console.error("Login failed:", error);

        } finally {
            setLoading(false);
        }
    };

    const fetchAllProjects = async () => {
        setLoadingProjects(true)
        const data = await getProjects()
        dispatch(setProjects(data))
        setLoadingProjects(false)
    }


    const fetchStarredProjects = async () => {
        setLoadingProjects(true)
        const data = await getStarredProjects()
        dispatch(setProjects(data))
        setLoadingProjects(false)
    }

    useEffect(() => {
        if (activeSession == "projects") {
            fetchAllProjects()
        } else {
            fetchStarredProjects()
        }
    }, [activeSession, userData])

    if (!userData) {
        return (<div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-slate-50 px-4 transition-colors duration-300 dark:bg-[#07070c]">
            <div className="pointer-events-none absolute -top-32 left-1/2 hidden h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[120px] dark:block" />

            <div className="relative w-full max-w-sm rounded-2xl border border-slate-200/70 bg-white/80 p-6 text-center shadow-xl shadow-slate-200/50 backdrop-blur-xl sm:p-8 dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-black/40">

                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-lg shadow-black/5 dark:border-transparent dark:bg-white/10">
                    <span className="text-lg font-bold text-slate-900 dark:text-white">
                        AI
                    </span>
                </div>

                <h2 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">
                    Welcome to VertexAI
                </h2>

                <p className="mb-6 text-[13.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Sign in to access your projects and continue building.
                </p>

                <button
                    onClick={handleLogin}
                    disabled={loading}
                    type="button"
                    className="w-full rounded-lg bg-slate-900 py-2.5 text-[13.5px] font-medium text-white shadow-sm transition-opacity duration-150 hover:opacity-90 dark:bg-white dark:text-slate-900"
                >
                    {loading ? "Signing in..." : "Continue with Google"} <FaGoogle className="ml-2 inline-block" />

                </button>

            </div>
        </div>)

    };


    return (
        <div className='relative flex h-screen w-full flex-col overflow-hidden bg-slate-50 transition-colors duration-300 dark:bg-[#07070c]'>

            <div className='pointer-events-none absolute -top-40 left-1/3 hidden h-[700px] w-[700px] rounded-full bg-white/[0.04] blur-[140px] dark:block' />
            <div className='pointer-events-none absolute right-0 top-1/3 hidden h-[500px] w-[500px] rounded-full bg-white/[0.03] blur-[130px] dark:block' />

            <div className='relative flex min-h-0 flex-1 flex-col'>
                <NavBar

                />
                <div className='flex min-h-0 flex-1'>
                    <div className='hidden md:block'>
                        <SideBar activeSession={activeSession} setActiveSession={setActiveSession} />

                    </div>

                    



                    <div
                        className='min-h-0 flex-1 overflow-y-auto px-4
              py-5
              sm:px-6
              sm:py-6
              lg:px-8
              lg:py-8
 [scrollbar-width:thin] [scrollbar-color:rgba(100,116,139,0.35)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-padding hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 dark:[&::-webkit-scrollbar-thumb]:bg-white/10 dark:hover:[&::-webkit-scrollbar-thumb]:bg-white/20'
                    >

                        <div

                            className="
                mb-4
                flex
                items-center
                gap-2
                rounded-lg
                border
                border-slate-200
                bg-white
                px-3
                py-2
                text-[12.5px]
                font-medium
                text-slate-600
                shadow-sm
                dark:border-white/[0.08]
                dark:bg-white/[0.04]
                dark:text-slate-300
                md:hidden
              "
                        >
                            <Menu size={14} />
                            Menu
                        </div>

                        <div className=' mb-6
                sm:mb-8
                flex
                flex-col
                sm:flex-row
                sm:items-start
                sm:justify-between
                gap-3
                sm:gap-4
'>
                            <div>
                                <h1 className='flex items-center gap-2 text-[26px] font-bold text-slate-900 dark:text-white '>
                                    Welcome Back, {" "}
                                    {(userData?.name)?.split(" ")[0] || "User"}
                                    <span>👋</span>
                                </h1>

                                <p className='mt-1 text-[13.5px] text-slate-500 dark:text-slate-400'>Ready to build something amazing today?</p>
                            </div>
                            <button
                                onClick={() => setOpenModal(true)}
                                className=' flex
                  w-full
                  sm:w-auto
                  shrink-0
                  items-center
                  justify-center
                  gap-1.5
                  rounded-lg
                  bg-slate-900
                  px-4
                  py-2.5
                  text-[13.5px]
                  font-semibold
                  text-white
                  shadow-sm
                  transition-opacity
                  duration-150
                  hover:opacity-90
                  dark:bg-white
                  dark:text-slate-900
'
                              
                            >
                                <Plus size={16} />
                                New Project
                            </button>
                        </div>

                        <div className='mb-4 flex items-center justify-between'>
                            <h2 className='text-[16px] font-semibold text-slate-900 dark:text-white'>
                                {activeSession === "projects" ? "Recent Projects" : "Starred Projects"}
                            </h2>
                        </div>

                        {loadingProjects ? (
                            <div className='flex min-h-[300px] items-center justify-center'>
                                <Loader2
                                    size={28}
                                    className="animate-spin text-slate-400 dark:text-slate-500"
                                />
                            </div>
                        ) : projects?.length == 0 ? (
                            <div className='mb-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/40  px-4
                  py-12
                  sm:py-16
 text-center dark:border-white/[0.1] dark:bg-white/[0.01]'>
                                <div className='mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900/5 dark:bg-white/10'>
                                    <Folder
                                        size={24}
                                        className="text-slate-500 dark:text-white"

                                    />
                                </div>

                                <h3 className='mb-1.5 text-[16px] font-semibold text-slate-900 dark:text-white'>
                                    {activeSession == "starred" ? "No starred projects" : "No projects yet"}
                                </h3>

                                <p className='mb-5 max-w-xs text-[13px] text-slate-500 dark:text-slate-500'>
                                    {activeSession == "starred" ? "Star a project to see it here." : "Create your first project and start building something amazing!"}
                                </p>

                            </div>
                        ) : (
                            <div className=' mb-8
                  grid
                  grid-cols-1
                  gap-3
                  sm:grid-cols-2
                  sm:gap-4
                  lg:grid-cols-3
                  xl:grid-cols-4
'>
                                {projects?.map((p, i) => (
                                    <ProjectCard project={p} />
                                ))}
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {openModal && <CreateProjectModal
                open={openModal}
                onClose={() => setOpenModal(false)}
            />}


        </div>
    )



              

}


export default Dashboard;