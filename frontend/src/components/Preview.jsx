
import React from 'react'

function Preview({ projectId }) {
    const previewUrl = `${import.meta.env.VITE_SERVER_URL.replace(/\/$/, '')}/preview/${projectId}/`
    return (
        <div className="flex h-full w-full flex-col bg-white">
            <div className="flex h-10 shrink-0 items-center justify-between bg-[#111113] px-4">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-xs text-zinc-300">Preview</span>
                </div>
            </div>

            <div className="min-h-0 flex-1 bg-white">
                <iframe
                    title="Project Preview"
                    src={previewUrl}
                    className="h-full w-full border-0"
                    allow="clipboard-read; clipboard-write"
                />
            </div>
        </div>
    )
}

export default Preview
