
import React, { useState, useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import LeftSidebar from './components/LeftSidebar';
import RightSidebar from './components/RightSidebar';
import ThreeCanvas, { ThreeCanvasHandle } from './components/ThreeCanvas';
import {
  AppState, SceneObject, MeshObject, PointLightObject, DirectionalLightObject, GroupObject,
  SelectableItem, SceneObjectType, AmbientLightObject, SkyConfig, TerrainConfig, CameraConfig,
  TerrainShape, ImportedGLBObject, Transform, HeightGenerationMethod, Vector3 as AppVector3
} from './types';

const initialAmbientLight: AmbientLightObject = {
  id: 'ambient_light_config',
  name: 'Luz Ambiente',
  type: SceneObjectType.AmbientLight,
  color: '#FFFFFF',
  intensity: 1,
};

const initialSkyConfig: SkyConfig = {
  id: 'sky_config',
  type: SceneObjectType.Sky,
  color: '#87CEEB',
};

const initialTerrainConfig: TerrainConfig = {
  id: 'terrain_config',
  type: SceneObjectType.Terrain,
  shape: TerrainShape.Plane,
  size: 50,
  color: '#556B2F',
  segments: 32, 
  heightGenerationMethod: HeightGenerationMethod.Flat,
  noiseScale: 0.1,
  noiseAmplitude: 0, 
  sineFrequencyX: 1,
  sineFrequencyZ: 1,
  sineAmplitude: 0, 
};

const initialCameraConfig: CameraConfig = {
  id: 'camera_config',
  type: SceneObjectType.Camera,
  position: { x: 5, y: 5, z: 15 },
  fov: 50,
};

const initialAppState: AppState = {
  sceneObjects: [],
  ambientLight: initialAmbientLight,
  sky: initialSkyConfig,
  terrain: initialTerrainConfig,
  cameraConfig: initialCameraConfig,
  selectedObjectIds: [],
  isLoading: false,
};

const isDuplicableItem = (item: SelectableItem | null): item is MeshObject | PointLightObject | DirectionalLightObject => {
    if (!item) return false;
    switch (item.type) {
        case SceneObjectType.Mesh:
        case SceneObjectType.PointLight:
        case SceneObjectType.DirectionalLight:
            return true;
        default:
            return false;
    }
};

// Helper function to calculate world matrix from appState
const calculateWorldMatrixFromState = (
    objectId: string | undefined, 
    allObjects: SceneObject[], 
    matricesCache: Map<string, THREE.Matrix4>
  ): THREE.Matrix4 => {
  if (!objectId) {
    // console.log('[CWMS] Reached root (no objectId), returning identity.');
    return new THREE.Matrix4(); // Identity for scene root
  }
  if (matricesCache.has(objectId)) {
    // console.log(`[CWMS] Cache hit for ${objectId}.`);
    return matricesCache.get(objectId)!.clone();
  }

  // console.log(`[CWMS] Calculating for ${objectId}`);
  const object = allObjects.find(obj => obj.id === objectId);
  if (!object) {
    // console.warn(`[CWMS] Object ${objectId} not found for matrix calculation.`); // Keep warns active
    return new THREE.Matrix4(); // Identity
  }

  // console.log(`[CWMS] Transform for ${objectId}:`, JSON.parse(JSON.stringify(object.transform)));
  const localMatrix = new THREE.Matrix4();
  const pos = object.transform.position;
  const rot = object.transform.rotation; // Assuming degrees
  const scale = object.transform.scale;

  localMatrix.compose(
    new THREE.Vector3(pos.x, pos.y, pos.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rot.x),
      THREE.MathUtils.degToRad(rot.y),
      THREE.MathUtils.degToRad(rot.z),
      'XYZ' // Consistent Euler order
    )),
    new THREE.Vector3(scale.x, scale.y, scale.z)
  );
  // console.log(`[CWMS] Local matrix for ${objectId}:`, localMatrix.elements);

  const parentWorldMatrix = calculateWorldMatrixFromState(object.parentId, allObjects, matricesCache);
  // if (object.parentId) console.log(`[CWMS] Parent (${object.parentId}) world matrix for ${objectId}:`, parentWorldMatrix.elements);
  // else console.log(`[CWMS] No parent for ${objectId}, parentWorldMatrix is identity.`);

  const worldMatrix = new THREE.Matrix4().multiplyMatrices(parentWorldMatrix, localMatrix);
  matricesCache.set(objectId, worldMatrix.clone());
  // console.log(`[CWMS] Calculated world matrix for ${objectId}:`, worldMatrix.elements);
  return worldMatrix;
};


const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(initialAppState);
  const threeCanvasRef = useRef<ThreeCanvasHandle>(null);

  const handleToggleSelection = useCallback((id: string | null, isMultiSelectKeyHeld: boolean) => {
    setAppState(prev => {
      if (id === null) {
        return { ...prev, selectedObjectIds: [] };
      }
      if (id === initialTerrainConfig.id && prev.terrain === null) {
          return prev;
      }
      const currentSelection = prev.selectedObjectIds;
      let newSelection: string[];
      if (isMultiSelectKeyHeld) {
        if (currentSelection.includes(id)) {
          newSelection = currentSelection.filter(selectedId => selectedId !== id);
        } else {
          newSelection = [...currentSelection, id];
        }
      } else {
        if (currentSelection.length === 1 && currentSelection[0] === id) {
          newSelection = currentSelection; 
        } else {
          newSelection = [id];
        }
      }
      return { ...prev, selectedObjectIds: newSelection };
    });
  }, []);

  const primarySelectedItemId = useMemo((): string | null => {
    if (appState.selectedObjectIds.length > 0) {
      return appState.selectedObjectIds[appState.selectedObjectIds.length - 1];
    }
    return null;
  }, [appState.selectedObjectIds]);

  const primarySelectedItemData = useMemo((): SelectableItem | null => {
    if (!primarySelectedItemId) return null;
    if (primarySelectedItemId === appState.sky.id) return appState.sky;
    if (primarySelectedItemId === initialTerrainConfig.id && appState.terrain) return appState.terrain;
    if (primarySelectedItemId === appState.cameraConfig.id) return appState.cameraConfig;
    if (primarySelectedItemId === appState.ambientLight.id) return appState.ambientLight;
    return appState.sceneObjects.find(obj => obj.id === primarySelectedItemId) || null;
  }, [primarySelectedItemId, appState.sceneObjects, appState.sky, appState.terrain, appState.cameraConfig, appState.ambientLight]);

  const handleAddItem = useCallback((item: SceneObject) => {
    const itemWithOpacity = { ...item, opacity: item.opacity ?? 1.0 };
    setAppState(prev => ({
      ...prev,
      sceneObjects: [...prev.sceneObjects, itemWithOpacity],
      selectedObjectIds: [itemWithOpacity.id],
    }));
  }, []);

  const handleUpdateItem = useCallback((updatedItem: SelectableItem) => {
    setAppState(prev => {
      if (updatedItem.id === prev.sky.id) return { ...prev, sky: updatedItem as SkyConfig };
      if (updatedItem.id === initialTerrainConfig.id && prev.terrain) {
          return { ...prev, terrain: updatedItem as TerrainConfig };
      }
      if (updatedItem.id === prev.cameraConfig.id) return { ...prev, cameraConfig: updatedItem as CameraConfig };
      if (updatedItem.id === prev.ambientLight.id) return { ...prev, ambientLight: updatedItem as AmbientLightObject };

      return {
        ...prev,
        sceneObjects: prev.sceneObjects.map(obj =>
          obj.id === (updatedItem as SceneObject).id ? (updatedItem as SceneObject) : obj
        ),
      };
    });
  }, []);

  const handleDeleteItem = useCallback((idToDelete: string) => {
    setAppState(prev => {
      if (idToDelete === initialTerrainConfig.id && prev.terrain) {
        return {
          ...prev,
          terrain: null,
          selectedObjectIds: prev.selectedObjectIds.filter(id => id !== idToDelete),
        };
      }
      
      const itemToDelete = prev.sceneObjects.find(obj => obj.id === idToDelete);
      let newSceneObjects = prev.sceneObjects.filter(obj => obj.id !== idToDelete);

      if (itemToDelete) {
        if (itemToDelete.type === SceneObjectType.Group) {
          const group = itemToDelete as GroupObject;
          newSceneObjects = newSceneObjects.map(so => {
            if (group.childIds.includes(so.id)) {
              return { ...so, parentId: undefined };
            }
            return so;
          });
        }
        else if (itemToDelete.parentId) {
          newSceneObjects = newSceneObjects.map(so => {
            if (so.id === itemToDelete.parentId && so.type === SceneObjectType.Group) {
              return { ...so, childIds: (so as GroupObject).childIds.filter(childId => childId !== idToDelete) };
            }
            return so;
          });
        }
      }
      return {
        ...prev,
        sceneObjects: newSceneObjects,
        selectedObjectIds: prev.selectedObjectIds.filter(id => id !== idToDelete),
      };
    });
  }, []);

  const handleDuplicateItem = useCallback((idToDuplicate: string) => {
    setAppState(prev => {
      const originalObject = prev.sceneObjects.find(obj => obj.id === idToDuplicate);
      if (!originalObject || !isDuplicableItem(originalObject)) return prev;

      const duplicatedObject = JSON.parse(JSON.stringify(originalObject)) as SceneObject;
      duplicatedObject.id = THREE.MathUtils.generateUUID();
      duplicatedObject.name = `${originalObject.name} (Cópia)`;
      duplicatedObject.transform.position.x += 0.5;
      duplicatedObject.transform.position.y += 0.5;
      duplicatedObject.parentId = undefined; 
      duplicatedObject.opacity = originalObject.opacity ?? 1.0;


      return {
        ...prev,
        sceneObjects: [...prev.sceneObjects, duplicatedObject],
        selectedObjectIds: [duplicatedObject.id],
      };
    });
  }, []);

  const handleSetParentGroup = useCallback((childId: string, newParentGroupId: string | null) => {
    setAppState(prev => {
      const child = prev.sceneObjects.find(obj => obj.id === childId);
      if (!child) return prev;

      const matricesCache = new Map<string, THREE.Matrix4>();
      const childWorldMatrix = calculateWorldMatrixFromState(childId, prev.sceneObjects, matricesCache);
      
      let newChildLocalTransform: Transform;

      if (newParentGroupId) {
        const newParentWorldMatrix = calculateWorldMatrixFromState(newParentGroupId, prev.sceneObjects, matricesCache);
        const invNewParentWorldMatrix = newParentWorldMatrix.clone().invert();
        const newLocalMatrix = new THREE.Matrix4().multiplyMatrices(invNewParentWorldMatrix, childWorldMatrix);
        
        const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scale = new THREE.Vector3();
        newLocalMatrix.decompose(pos, quat, scale);
        const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
        newChildLocalTransform = {
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotation: { x: THREE.MathUtils.radToDeg(euler.x), y: THREE.MathUtils.radToDeg(euler.y), z: THREE.MathUtils.radToDeg(euler.z) },
          scale: { x: scale.x, y: scale.y, z: scale.z },
        };
      } else { 
        const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scale = new THREE.Vector3();
        childWorldMatrix.decompose(pos, quat, scale);
        const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
        newChildLocalTransform = {
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotation: { x: THREE.MathUtils.radToDeg(euler.x), y: THREE.MathUtils.radToDeg(euler.y), z: THREE.MathUtils.radToDeg(euler.z) },
          scale: { x: scale.x, y: scale.y, z: scale.z },
        };
      }

      let updatedSceneObjects = prev.sceneObjects.map(obj => {
        if (obj.id === childId) { 
          return { ...obj, parentId: newParentGroupId || undefined, transform: newChildLocalTransform }; 
        }
        return obj;
      });

      updatedSceneObjects = updatedSceneObjects.map(obj => {
        if (obj.type === SceneObjectType.Group) {
          const group = obj as GroupObject;
          const correctChildIds = updatedSceneObjects
            .filter(childCandidate => childCandidate.parentId === group.id)
            .map(c => c.id);
          
          const currentChildIdsSorted = [...group.childIds].sort().join(',');
          const correctChildIdsSorted = [...correctChildIds].sort().join(',');
          if (currentChildIdsSorted !== correctChildIdsSorted) {
            return { ...group, childIds: correctChildIds };
          }
        }
        return obj;
      });
      return { ...prev, sceneObjects: updatedSceneObjects };
    });
  }, []);

  const handleDisbandGroup = useCallback((groupId: string) => {
    setAppState(prev => {
      const groupToDisband = prev.sceneObjects.find(obj => obj.id === groupId && obj.type === SceneObjectType.Group) as GroupObject | undefined;
      if (!groupToDisband) return prev;

      const matricesCache = new Map<string, THREE.Matrix4>();
      const groupWorldMatrix = calculateWorldMatrixFromState(groupId, prev.sceneObjects, matricesCache);

      let updatedSceneObjects = prev.sceneObjects
        .filter(obj => obj.id !== groupId) 
        .map(obj => {
          if (groupToDisband.childIds.includes(obj.id)) {
            const oldChildLocalMatrix = new THREE.Matrix4().compose(
                new THREE.Vector3(obj.transform.position.x, obj.transform.position.y, obj.transform.position.z),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(
                    THREE.MathUtils.degToRad(obj.transform.rotation.x), 
                    THREE.MathUtils.degToRad(obj.transform.rotation.y), 
                    THREE.MathUtils.degToRad(obj.transform.rotation.z), 'XYZ')),
                new THREE.Vector3(obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z)
            );
            const childNewWorldMatrix = new THREE.Matrix4().multiplyMatrices(groupWorldMatrix, oldChildLocalMatrix);
            
            const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scale = new THREE.Vector3();
            childNewWorldMatrix.decompose(pos, quat, scale);
            const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');

            return { 
              ...obj, 
              parentId: undefined, 
              transform: {
                position: { x: pos.x, y: pos.y, z: pos.z },
                rotation: { x: THREE.MathUtils.radToDeg(euler.x), y: THREE.MathUtils.radToDeg(euler.y), z: THREE.MathUtils.radToDeg(euler.z) },
                scale: { x: scale.x, y: scale.y, z: scale.z },
              } 
            };
          }
          return obj;
        });
      
      updatedSceneObjects = updatedSceneObjects.map(obj => {
        if (obj.type === SceneObjectType.Group) {
          const group = obj as GroupObject;
          const correctChildIds = updatedSceneObjects
            .filter(childCandidate => childCandidate.parentId === group.id)
            .map(c => c.id);
          const currentChildIdsSorted = [...group.childIds].sort().join(',');
          const correctChildIdsSorted = [...correctChildIds].sort().join(',');
          if (currentChildIdsSorted !== correctChildIdsSorted) {
            return { ...group, childIds: correctChildIds };
          }
        }
        return obj;
      });

      return {
        ...prev,
        sceneObjects: updatedSceneObjects,
        selectedObjectIds: prev.selectedObjectIds.filter(id => id !== groupId || groupToDisband.childIds.includes(id)), 
      };
    });
  }, []);

  const handleImportGLB = useCallback((file: File) => {
    if (!threeCanvasRef.current) { alert("Import functionality not ready."); return; }
    setAppState(prev => ({ ...prev, isLoading: true }));
    threeCanvasRef.current.importGLB( file,
      (importedModelData: { id: string; name: string; transform: Transform }) => {
        const newGlbObject: ImportedGLBObject = {
          id: importedModelData.id, name: importedModelData.name,
          type: SceneObjectType.ImportedGLB, transform: importedModelData.transform,
          opacity: 1.0, // Default opacity for new GLB
        };
        setAppState(prev => ({
          ...prev, sceneObjects: [...prev.sceneObjects, newGlbObject],
          selectedObjectIds: [newGlbObject.id], isLoading: false,
        }));
        alert(`GLB "${file.name}" imported as "${newGlbObject.name}".`);
      },
      (error: any) => {
        console.error("Failed to import GLB:", error);
        alert(`Failed to import GLB: ${error.message || 'Unknown error'}`);
        setAppState(prev => ({ ...prev, isLoading: false }));
      }
    );
  }, []);

  const handleExportGLB = useCallback(() => {
    if (threeCanvasRef.current?.exportGLB) {
      setAppState(prev => ({ ...prev, isLoading: true }));
      try { threeCanvasRef.current.exportGLB(); }
      catch (e) { console.error("Error calling exportGLB:", e); alert("Error initiating export."); }
      finally { setTimeout(() => setAppState(prev => ({ ...prev, isLoading: false })), 500); }
    } else { alert("Export functionality not ready."); }
  }, []);

  const handleUpdateCameraConfig = useCallback((newConfig: CameraConfig) => {
    setAppState(prev => ({...prev, cameraConfig: newConfig}));
  }, []);

  const handleAddTerrain = useCallback(() => {
    setAppState(prev => {
      if (prev.terrain === null) {
        return { ...prev, terrain: { ...initialTerrainConfig }, selectedObjectIds: [initialTerrainConfig.id] };
      }
      return prev;
    });
  }, []);

  const handleCreateGroupFromSelection = useCallback(() => {
    setAppState(prev => {
      const selectedObjectsData = prev.selectedObjectIds
        .map(id => prev.sceneObjects.find(obj => obj.id === id))
        .filter((item): item is SceneObject =>
          item !== undefined && item.type !== SceneObjectType.Group &&
          (item.type === SceneObjectType.Mesh || item.type === SceneObjectType.PointLight ||
           item.type === SceneObjectType.DirectionalLight || item.type === SceneObjectType.ImportedGLB)
        );

      const idsToGroup = selectedObjectsData.map(item => item.id);
      if (idsToGroup.length < 1) { 
        alert("Selecione um ou mais objetos válidos (malhas, luzes, GLBs importados) para agrupar."); 
        return prev; 
      }

      const newGroupId = THREE.MathUtils.generateUUID();
      const matricesCache = new Map<string, THREE.Matrix4>();

      const childrenWorldPositions: THREE.Vector3[] = [];
      selectedObjectsData.forEach(obj => {
        const childWorldMatrix = calculateWorldMatrixFromState(obj.id, prev.sceneObjects, matricesCache);
        childrenWorldPositions.push(new THREE.Vector3().setFromMatrixPosition(childWorldMatrix));
      });

      const groupWorldPosition = new THREE.Vector3();
      if (childrenWorldPositions.length > 0) {
        childrenWorldPositions.forEach(pos => groupWorldPosition.add(pos));
        groupWorldPosition.divideScalar(childrenWorldPositions.length);
      }
      
      const newGroupTransform: Transform = {
        position: { x: groupWorldPosition.x, y: groupWorldPosition.y, z: groupWorldPosition.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      
      const newGroupWorldMatrix = new THREE.Matrix4().compose(
        groupWorldPosition, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)
      );
      const invNewGroupWorldMatrix = newGroupWorldMatrix.clone().invert();

      const itemsToKeep = prev.sceneObjects.filter(obj => !idsToGroup.includes(obj.id));
      
      const updatedChildren = selectedObjectsData.map(objToGroup => {
          const childCurrentWorldMatrix = calculateWorldMatrixFromState(objToGroup.id, prev.sceneObjects, matricesCache);
          const childNewLocalMatrix = new THREE.Matrix4().multiplyMatrices(invNewGroupWorldMatrix, childCurrentWorldMatrix);
          const newLocalPos = new THREE.Vector3(); 
          const newLocalQuat = new THREE.Quaternion(); 
          const newLocalScale = new THREE.Vector3();
          childNewLocalMatrix.decompose(newLocalPos, newLocalQuat, newLocalScale);
          const newLocalEuler = new THREE.Euler().setFromQuaternion(newLocalQuat, 'XYZ');
          return {
            ...objToGroup,
            parentId: newGroupId,
            transform: {
              position: { x: newLocalPos.x, y: newLocalPos.y, z: newLocalPos.z },
              rotation: { x: THREE.MathUtils.radToDeg(newLocalEuler.x), y: THREE.MathUtils.radToDeg(newLocalEuler.y), z: THREE.MathUtils.radToDeg(newLocalEuler.z) },
              scale: { x: newLocalScale.x, y: newLocalScale.y, z: newLocalScale.z },
            },
          };
        });

      const newGroupAppObject: GroupObject = {
        id: newGroupId,
        name: `Grupo ${Date.now() % 1000}`,
        type: SceneObjectType.Group,
        transform: newGroupTransform,
        childIds: updatedChildren.map(c => c.id),
        parentId: undefined, 
        opacity: 1.0, // Default opacity for new group
      };

      let newSceneObjectsList = [...itemsToKeep, ...updatedChildren, newGroupAppObject];

      newSceneObjectsList = newSceneObjectsList.map(obj => {
        if (obj.type === SceneObjectType.Group && obj.id !== newGroupId) {
          const group = obj as GroupObject;
          const correctChildIdsForThisGroup = newSceneObjectsList
            .filter(childCandidate => childCandidate.parentId === group.id)
            .map(c => c.id);
          
          if ([...group.childIds].sort().join(',') !== [...correctChildIdsForThisGroup].sort().join(',')) {
            return { ...group, childIds: correctChildIdsForThisGroup };
          }
        }
        return obj;
      });
      
      return { ...prev, sceneObjects: newSceneObjectsList, selectedObjectIds: [newGroupId] };
    });
  }, []);


  const handleUpdateObjectTransform = useCallback((objectId: string, newTransform: Transform) => {
    setAppState(prev => {
      const objectIndex = prev.sceneObjects.findIndex(obj => obj.id === objectId);
      if (objectIndex === -1) return prev;

      const updatedObject = {
        ...prev.sceneObjects[objectIndex],
        transform: newTransform,
      };
      const newSceneObjects = [...prev.sceneObjects];
      newSceneObjects[objectIndex] = updatedObject;
      return { ...prev, sceneObjects: newSceneObjects };
    });
  }, []);

  const isDeletablePrimaryItem = useCallback(() => {
    if (!primarySelectedItemData) return false;
    if (primarySelectedItemData.type === SceneObjectType.Terrain && primarySelectedItemData.id === initialTerrainConfig.id && appState.terrain !== null) { return true; }
    const deletableSceneObjectTypes: SceneObjectType[] = [
      SceneObjectType.Mesh, SceneObjectType.PointLight, SceneObjectType.DirectionalLight,
      SceneObjectType.Group, SceneObjectType.ImportedGLB,
    ];
    if ('type' in primarySelectedItemData && deletableSceneObjectTypes.includes(primarySelectedItemData.type as SceneObjectType) && 'id' in primarySelectedItemData) {
        return appState.sceneObjects.some(so => so.id === (primarySelectedItemData as SceneObject).id);
    }
    return false;
  }, [primarySelectedItemData, appState.terrain, appState.sceneObjects]);

  const onDuplicateItemProp = primarySelectedItemData && isDuplicableItem(primarySelectedItemData)
    ? () => { if (primarySelectedItemData?.id && typeof (primarySelectedItemData as SceneObject).id === 'string') { handleDuplicateItem((primarySelectedItemData as SceneObject).id); } }
    : undefined;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900">
      <LeftSidebar
        onAddItem={handleAddItem}
        onToggleSelection={handleToggleSelection}
        onImportGLB={handleImportGLB}
        onExportGLB={handleExportGLB}
        selectedObjectIds={appState.selectedObjectIds}
        onCreateGroupFromSelection={handleCreateGroupFromSelection}
        appState={appState}
        onAddTerrain={handleAddTerrain}
      />
      <main className="flex-1 relative bg-gray-700">
        <ThreeCanvas
          ref={threeCanvasRef}
          appState={appState}
          onSelectObject={handleToggleSelection}
          onUpdateCameraConfig={handleUpdateCameraConfig}
          onUpdateObjectTransform={handleUpdateObjectTransform}
        />
        {appState.isLoading && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="text-white text-xl p-6 bg-gray-800 rounded-lg shadow-xl flex items-center">
              <svg className="animate-spin h-8 w-8 text-blue-400 mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Carregando...
            </div>
          </div>
        )}
      </main>
      {primarySelectedItemData && (appState.terrain || primarySelectedItemData.id !== initialTerrainConfig.id) && (
         <RightSidebar
            selectedItem={primarySelectedItemData}
            appState={appState}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={isDeletablePrimaryItem() ? handleDeleteItem : undefined}
            onDuplicateItem={onDuplicateItemProp}
            onSetParentGroup={handleSetParentGroup} 
            onDisbandGroup={handleDisbandGroup}   
        />
      )}
    </div>
  );
};

export default App;
