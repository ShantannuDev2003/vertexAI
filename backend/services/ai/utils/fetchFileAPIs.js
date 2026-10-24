import axios from "axios"
import dotenv from "dotenv"
dotenv.config()
const File_url = process.env.FILE_SERVICE_URL

if (!File_url) {
    throw new Error("FILE_SERVICE_URL is not configured")
}

const fileService = axios.create({
    baseURL: File_url.replace(/\/+$/, ""),
    timeout: 15000
})

const toFileServiceError = (error) => {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status
        const message =
            error.response?.data?.message ||
            error.message ||
            "Unknown File Service error"

        return new Error(
            status
                ? `File Service request failed (${status}): ${message}`
                : `File Service request failed: ${message}`
        )
    }

    return error instanceof Error
        ? error
        : new Error(String(error))
}
export const createFolder = async ({ projectId, parentId, name, userId }) => {
    try {
        const { data } = await fileService.post("/create-folder",
            { projectId, parentId, name },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        )

        return data
    } catch (error) {
        throw toFileServiceError(error)
    }
}

export const createFile = async ({ projectId, name, parentId, content = "", language = "plaintext", userId }) => {
    try {
        const { data } = await fileService.post("/create-file",
            { projectId, name, parentId, content, language },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        )

        return data
    } catch (error) {
        throw toFileServiceError(error)
    }
}


export const updateFile = async ({ name, content = "", userId, id }) => {
    try {
        const { data } = await fileService.post(`/update/${id}`,
            { name, content },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        )

        return data
    } catch (error) {
        throw toFileServiceError(error)
    }
}

export const deleteFile = async ({ userId, id }) => {
    try {
        const { data } = await fileService.delete(`/delete/${id}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        )

        return data
    } catch (error) {
        throw toFileServiceError(error)
    }
}

export const getTree = async ({ userId, projectId }) => {
    try {
        const { data } = await fileService.get(`/tree/${projectId}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        )

        return data
    } catch (error) {
        throw toFileServiceError(error)
    }
}

export const getFile = async ({ userId, id }) => {
    try {
        const { data } = await fileService.get(`/file/${id}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        )

        return data
    } catch (error) {
        throw toFileServiceError(error)
    }
}
