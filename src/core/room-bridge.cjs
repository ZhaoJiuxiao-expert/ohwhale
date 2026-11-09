'use strict';
// Models are local owned assets. Scene annotations may only attach to their nodes.
function applyRoomScene(rooms,models,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('小屋布置信息不完整。');
 const current=rooms.get({roomId:input.roomId}).scene;
 const modelId=input.modelId===undefined?current.modelId:input.modelId;
 if(modelId){
  const {model}=models.metadata({modelId});
  if(input.objects!==undefined){
   if(!Array.isArray(input.objects)||input.objects.length>24)throw Error('先挑出最多24件想互动的物件吧。');
   const nodes=new Set(model.nodes.map(node=>node.id));
   for(const object of input.objects)if(!object||!nodes.has(object.id))throw Error('这个物件不属于当前小屋模型，请重新选择。');
  }
 }
 return rooms.scene(input);
}
module.exports={applyRoomScene};
