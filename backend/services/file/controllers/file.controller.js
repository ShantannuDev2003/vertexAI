import File from "../models/file.model.js"
import { buildTree } from "../utils/buildTree.js"


// --------------------------------------------------
// CREATE ROOT FOLDER
// --------------------------------------------------
export const createRootFolder = async (req, res) => {
    try {
        // Data sent by the frontend
        const { projectId, projectName } = req.body

        // User ID is added by API Gateway after authentication
        const userId = req.headers["x-user-id"]

        // Basic validation
        if (!projectId || !projectName) {
            return res.status(400).json({
                message: "projectId and projectName are required!"
            })
        }

        // Make sure an authenticated user exists
        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized"
            })
        }

        // Check whether this project already has a root folder
        const existingRootFolder = await File.findOne({
            projectId,
            owner: userId,
            parentId: null,
            isDeleted: false
        })

        // Only one root folder should exist for a project
        if (existingRootFolder) {
            return res.status(400).json({
                message: "Root folder already exists"
            })
        }

        // Create the root folder
        const rootFolder = await File.create({
            owner: userId,
            name: projectName,
            projectId,
            type: "folder",
            parentId: null
        })

        return res.status(201).json(rootFolder)

    } catch (error) {
        return res.status(500).json({
            message: `Create root folder error: ${error.message}`
        })
    }
}


// --------------------------------------------------
// CREATE FOLDER
// --------------------------------------------------
export const createFolder = async (req, res) => {
    try {
        const { projectId, name, parentId } = req.body

        // User identity comes from Gateway
        const userId = req.headers["x-user-id"]

        // Validate required fields
        if (!projectId || !name || !parentId) {
            return res.status(400).json({
                message: "projectId, parentId and name are required!"
            })
        }

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized"
            })
        }

        // --------------------------------------------------
        // Validate parent folder
        // --------------------------------------------------
        // This prevents a user from creating a folder inside
        // another user's project/folder.
        const parentFolder = await File.findOne({
            _id: parentId,
            projectId,
            owner: userId,
            type: "folder",
            isDeleted: false
        })

        if (!parentFolder) {
            return res.status(404).json({
                message: "Parent folder not found"
            })
        }

        // --------------------------------------------------
        // Prevent duplicate folder names
        // --------------------------------------------------
        // Two folders with the same name are not allowed
        // inside the same parent folder.
        const existingFolder = await File.findOne({
            name,
            projectId,
            parentId,
            owner: userId,
            type: "folder",
            isDeleted: false
        })

        if (existingFolder) {
            return res.status(400).json({
                message: "Folder already exists"
            })
        }

        // Create the folder
        const folder = await File.create({
            owner: userId,
            name,
            projectId,
            type: "folder",
            parentId
        })

        return res.status(201).json(folder)

    } catch (error) {
        return res.status(500).json({
            message: `Create folder error: ${error.message}`
        })
    }
}


// --------------------------------------------------
// CREATE FILE
// --------------------------------------------------
export const createFile = async (req, res) => {
    try {
        const {
            projectId,
            name,
            parentId,
            content = "",
            language = "plaintext"
        } = req.body

        const userId = req.headers["x-user-id"]

        // Validate required fields
        if (!projectId || !name || !parentId) {
            return res.status(400).json({
                message: "projectId, parentId and name are required!"
            })
        }

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized"
            })
        }

        // --------------------------------------------------
        // Validate parent folder
        // --------------------------------------------------
        // The file must belong to a folder owned by the
        // authenticated user and inside the same project.
        const parentFolder = await File.findOne({
            _id: parentId,
            projectId,
            owner: userId,
            type: "folder",
            isDeleted: false
        })

        if (!parentFolder) {
            return res.status(404).json({
                message: "Parent folder not found"
            })
        }

        // --------------------------------------------------
        // Prevent duplicate file names
        // --------------------------------------------------
        const existingFile = await File.findOne({
            name,
            projectId,
            parentId,
            owner: userId,
            type: "file",
            isDeleted: false
        })

        if (existingFile) {
            return res.status(400).json({
                message: "File already exists"
            })
        }

        // Extract extension from filename
        // Example: App.js -> js
        const extension = name.includes(".")
            ? name.split(".").pop()
            : ""

        // Create the file
        const file = await File.create({
            owner: userId,
            name,
            projectId,
            type: "file",
            language,
            content,
            extension,
            size: content.length,
            parentId
        })

        return res.status(201).json(file)

    } catch (error) {
        return res.status(500).json({
            message: `Create file error: ${error.message}`
        })
    }
}


// --------------------------------------------------
// UPDATE FILE
// --------------------------------------------------
export const updateFile = async (req, res) => {
    try {
        const { name, content } = req.body

        const userId = req.headers["x-user-id"]

        // Find the file only if it belongs to the
        // authenticated user and is not deleted.
        const file = await File.findOne({
            _id: req.params.id,
            owner: userId,
            isDeleted: false
        })

        if (!file) {
            return res.status(404).json({
                message: "File not found"
            })
        }

        // --------------------------------------------------
        // Update filename and extension
        // --------------------------------------------------
        if (name) {
            file.name = name

            // IMPORTANT:
            // The previous code calculated extension but
            // never assigned it to file.extension.
            //
            // Example:
            // name = "server.js"
            // extension = "js"
            file.extension = name.includes(".")
                ? name.split(".").pop()
                : ""
        }

        // --------------------------------------------------
        // Update file content
        // --------------------------------------------------
        if (content !== undefined) {
            file.content = content

            // Store content size
            file.size = content.length
        }

        // Save updated document
        await file.save()

        return res.status(200).json(file)

    } catch (error) {
        return res.status(500).json({
            message: `Update file error: ${error.message}`
        })
    }
}


// --------------------------------------------------
// DELETE FILE
// --------------------------------------------------
export const deleteFile = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"]

        // Soft delete:
        // We don't physically remove the document.
        //
        // Instead:
        // isDeleted = true
        //
        // This allows us to potentially implement
        // restore/permanent-delete functionality later.
        const file = await File.findOneAndUpdate(
            {
                _id: req.params.id,
                owner: userId,
                isDeleted: false
            },
            {
                isDeleted: true
            },
            {
                new: true
            }
        )

        // File doesn't exist or doesn't belong to user
        if (!file) {
            return res.status(404).json({
                message: "File not found"
            })
        }

        return res.status(200).json(file)

    } catch (error) {
        return res.status(500).json({
            message: `Delete file error: ${error.message}`
        })
    }
}


// --------------------------------------------------
// GET SINGLE FILE
// --------------------------------------------------
export const getFile = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"]

        // Only return a file if:
        // 1. ID matches
        // 2. User owns it
        // 3. File isn't deleted
        const file = await File.findOne({
            _id: req.params.id,
            owner: userId,
            isDeleted: false
        })

        if (!file) {
            return res.status(404).json({
                message: "File not found"
            })
        }

        return res.status(200).json(file)

    } catch (error) {
        return res.status(500).json({
            message: `Get file error: ${error.message}`
        })
    }
}


// --------------------------------------------------
// GET PROJECT FILE TREE
// --------------------------------------------------
export const getTree = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"]

        const { projectId } = req.params

        // Get all files/folders belonging to this user
        // and project.
        //
        // Deleted files are excluded.
        const files = await File.find({
            projectId,
            owner: userId,
            isDeleted: false
        }).sort({
            name: 1,
            type: -1
        })

        // Convert flat MongoDB documents into
        // nested folder/file structure.
        const tree = buildTree(files)

        return res.status(200).json(tree)

    } catch (error) {
        return res.status(500).json({
            message: `Get tree error: ${error.message}`
        })
    }
}