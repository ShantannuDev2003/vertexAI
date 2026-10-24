

export const buildTree=(files)=>{
let map={}
let tree=[]
// // map ={
//    id:{
//     file,
//     children:[]
//    }
// }
files.forEach(file => {
    map[file._id.toString()]={
        ...file.toObject(),
        children:[]
    }   
});

files.forEach(file=>{
    const id=file._id.toString()
    if(file.parentId){
        let parent=map[file.parentId.toString()]
         if(parent){
            parent.children.push(map[id])
         }
    }else{
        tree.push(map[id])
    }
})
  
return tree

}


// [
//     { _id: "1", name: "project-root", type: "folder", parentId: null },
//     { _id: "2", name: "src", type: "folder", parentId: "1" },
//     { _id: "3", name: "README.md", type: "file", parentId: "1" },
//     { _id: "4", name: "index.js", type: "file", parentId: "2" },
//     { _id: "5", name: "utils", type: "folder", parentId: "2" },
//     { _id: "6", name: "helpers.js", type: "file", parentId: "5" },
// ]


// {
//     "1": { _id: "1", name: "project-root", parentId: null, children: [] },
//     "2": { _id: "2", name: "src", parentId: "1", children: [] },
//     "3": { _id: "3", name: "README.md", parentId: "1", children: [] },
//     "4": { _id: "4", name: "index.js", parentId: "2", children: [] },
//     "5": { _id: "5", name: "utils", parentId: "2", children: [] },
//     "6": { _id: "6", name: "helpers.js", parentId: "5", children: [] },
// }


// [
//     {
//         _id: "1",
//         name: "project-root",
//         parentId: null,
//         children: [
//             {
//                 _id: "2",
//                 name: "src",
//                 parentId: "1",
//                 children: [
//                     {
//                         _id: "4",
//                         name: "index.js",
//                         parentId: "2",
//                         children: []
//                     },
//                     {
//                         _id: "5",
//                         name: "utils",
//                         parentId: "2",
//                         children: [
//                             {
//                                 _id: "6",
//                                 name: "helpers.js",
//                                 parentId: "5",
//                                 children: []
//                             }
//                         ]
//                     }
//                 ]
//             },
//             {
//                 _id: "3",
//                 name: "README.md",
//                 parentId: "1",
//                 children: []
//             }
//         ]
//     }
// ]