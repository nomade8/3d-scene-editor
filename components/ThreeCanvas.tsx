
import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  AppState, SceneObject, MeshObject, PointLightObject, DirectionalLightObject, GroupObject,
  SceneObjectType, ShapeType, CameraConfig, TerrainConfig, AmbientLightObject,
  ImportedGLBObject, Transform, HeightGenerationMethod, ThreeCanvasProps, Vector3 as AppVector3
} from '../types';
import { SimplexNoise } from '../utils/SimplexNoise';

export interface ThreeCanvasHandle {
  exportGLB: () => void;
  importGLB: (
    file: File,
    onSuccess: (data: { id: string; name: string; transform: Transform }) => void,
    onError: (error: any) => void
  ) => void;
}

const TERRAIN_ID = 'terrain_config';
const simplexNoise = new SimplexNoise(Math.random());

// --- Gizmo Configuration ---
const GIZMO_SCALE_ADJUST_FACTOR = 0.1; 
const GIZMO_AXIS_LENGTH = 0.8;
const GIZMO_CONE_RADIUS = 0.08;
const GIZMO_CONE_HEIGHT = 0.2;
const GIZMO_CYLINDER_RADIUS = 0.015;

function createAxisGizmo(axis: 'x' | 'y' | 'z', color: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group();
  group.name = `gizmo-axis-group-${axis}`;

  const coneGeometry = new THREE.ConeGeometry(GIZMO_CONE_RADIUS, GIZMO_CONE_HEIGHT, 12);
  const cylinderLength = GIZMO_AXIS_LENGTH - GIZMO_CONE_HEIGHT;
  const cylinderGeometry = new THREE.CylinderGeometry(GIZMO_CYLINDER_RADIUS, GIZMO_CYLINDER_RADIUS, cylinderLength, 8);
  
  const material = new THREE.MeshBasicMaterial({ 
    color, 
    depthTest: false, 
    transparent: true, 
    opacity: 0.85,
  });
  
  const cone = new THREE.Mesh(coneGeometry, material);
  const cylinder = new THREE.Mesh(cylinderGeometry, material);

  cylinder.position.y = cylinderLength / 2;
  cone.position.y = cylinderLength + GIZMO_CONE_HEIGHT / 2;

  group.add(cylinder);
  group.add(cone);
  group.renderOrder = 999; 
  
  cylinder.userData = { type: 'gizmo-handle', axis };
  cone.userData = { type: 'gizmo-handle', axis };
  group.userData = { type: 'gizmo-handle-group', axis};

  if (axis === 'x') {
    group.rotation.z = -Math.PI / 2;
  } else if (axis === 'z') {
    group.rotation.x = Math.PI / 2;
  }

  return group;
}
// --- End Gizmo Configuration ---

// --- Opacity Helper Functions ---
const calculateEffectiveOpacity = (
  objId: string,
  allSceneObjects: SceneObject[], 
  objectMap: Map<string, SceneObject>
): number => {
  const obj = objectMap.get(objId);
  if (!obj) return 1.0;

  let effectiveOpacity = obj.opacity ?? 1.0;
  let currentParentId = obj.parentId;
  while (currentParentId) {
    const parentObj = objectMap.get(currentParentId);
    if (parentObj && (parentObj.type === SceneObjectType.Group || parentObj.type === SceneObjectType.ImportedGLB)) {
      effectiveOpacity *= (parentObj.opacity ?? 1.0);
      currentParentId = parentObj.parentId;
    } else {
      break; 
    }
  }
  return Math.max(0, Math.min(1, effectiveOpacity)); 
};

const applyOpacityToMaterial = (materialInstance: THREE.Material | THREE.Material[], opacityValue: number) => {
  const apply = (mat: THREE.Material) => {
    if ('opacity' in mat && 'transparent' in mat) {
      const meshMat = mat as any; 
      const needsUpdate = meshMat.opacity !== opacityValue || meshMat.transparent !== (opacityValue < 1.0);
      
      meshMat.transparent = opacityValue < 1.0;
      meshMat.opacity = opacityValue;
      
      if(needsUpdate) meshMat.needsUpdate = true;
    }
  };
  if (Array.isArray(materialInstance)) materialInstance.forEach(apply);
  else apply(materialInstance);
};
// --- End Opacity Helper Functions ---


const ThreeCanvas = forwardRef<ThreeCanvasHandle, ThreeCanvasProps>(({ appState, onSelectObject, onUpdateCameraConfig, onUpdateObjectTransform }, ref) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const appStateRef = useRef(appState);
  
  const selectionHelpersRef = useRef<Map<string, THREE.BoxHelper>>(new Map());
  const lightHelpersRef = useRef<Map<string, THREE.PointLightHelper | THREE.DirectionalLightHelper>>(new Map());

  const gizmoObjectRef = useRef<THREE.Group | null>(null);
  const isGizmoDraggingRef = useRef<boolean>(false);
  const selectedGizmoAxisRef = useRef<'x' | 'y' | 'z' | null>(null);
  const draggedThreeObjectRef = useRef<THREE.Object3D | null>(null); 
  
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());
  const dragLineDirectionRef = useRef<THREE.Vector3>(new THREE.Vector3()); 
  const selectedObjectInitialPositionRef = useRef<THREE.Vector3>(new THREE.Vector3()); 
  const dragStartOffsetOnPlaneRef = useRef<THREE.Vector3>(new THREE.Vector3());


  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const importGLB = useCallback((
    file: File,
    onSuccess: (data: { id: string; name: string; transform: Transform }) => void,
    onError: (error: any) => void
  ) => {
    if (!sceneRef.current) { onError(new Error("Three.js scene not initialized.")); return; }
    const loader = new GLTFLoader();
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result && sceneRef.current) {
        const newId = THREE.MathUtils.generateUUID();
        const safeFileName = file.name.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
        const modelName = `imported-${safeFileName}-${Date.now() % 1000}`;
        loader.parse( event.target.result as ArrayBuffer, '', (gltf) => {
            const model = gltf.scene;
            model.uuid = newId; model.name = modelName;
            model.userData.appId = newId; 
            model.userData.isImportedGLB = true;

            model.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                const meshChild = child as THREE.Mesh;
                if (Array.isArray(meshChild.material)) {
                  meshChild.userData.originalOpacities = meshChild.material.map(m => ('opacity' in m ? (m as any).opacity : 1.0));
                } else if (meshChild.material && 'opacity' in meshChild.material) {
                  meshChild.userData.originalOpacity = (meshChild.material as any).opacity;
                } else {
                  meshChild.userData.originalOpacity = 1.0;
                }
              }
            });
            const initialTransform: Transform = {
              position: { x: model.position.x, y: model.position.y, z: model.position.z },
              rotation: { x: THREE.MathUtils.radToDeg(model.rotation.x), y: THREE.MathUtils.radToDeg(model.rotation.y), z: THREE.MathUtils.radToDeg(model.rotation.z)},
              scale: { x: model.scale.x, y: model.scale.y, z: model.scale.z },
            };
            sceneRef.current?.add(model); 
            onSuccess({ id: newId, name: modelName, transform: initialTransform });
          }, (error) => { console.error('[TC] GLB parse error:', error); onError(error); });
      } else { onError(new Error("File could not be read or scene unavailable.")); }
    };
    reader.onerror = (errorEvent) => { console.error('[TC] File read error:', errorEvent); onError(errorEvent); };
    reader.readAsArrayBuffer(file);
  }, []);

  const exportGLB = useCallback(() => {
    if (!sceneRef.current) {
        alert('Scene not available for export.');
        return;
    }
    const exporter = new GLTFExporter();
    const currentFullAppState = appStateRef.current;
    const exportScene = new THREE.Scene();

    if (sceneRef.current.background && sceneRef.current.background instanceof THREE.Color) {
        exportScene.background = sceneRef.current.background.clone();
    }
    
    const terrainAppObj = currentFullAppState.terrain;
    if (terrainAppObj) {
        const terrainThreeObj = sceneRef.current.getObjectByProperty('uuid', terrainAppObj.id);
        if (terrainThreeObj) exportScene.add(terrainThreeObj.clone(true));
    }

    const ambientAppObj = currentFullAppState.ambientLight;
    const ambientThreeObj = sceneRef.current.getObjectByProperty('uuid', ambientAppObj.id);
    if (ambientThreeObj) exportScene.add(ambientThreeObj.clone(true));

    currentFullAppState.sceneObjects.forEach(objData => {
        if (!objData.parentId) { 
            const threeObj = sceneRef.current?.getObjectByProperty('appId', objData.id) || sceneRef.current?.getObjectByProperty('uuid', objData.id);
            if (threeObj && !exportScene.getObjectByProperty('uuid', threeObj.uuid) ) { 
                exportScene.add(threeObj.clone(true)); 
            }
        }
    });
    
    exporter.parse(
        exportScene,
        (gltf) => {
            const output = gltf instanceof ArrayBuffer ? gltf : JSON.stringify(gltf, null, 2);
            const blob = new Blob([output], { type: 'model/gltf-binary' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `scene-${Date.now()}.glb`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            alert('Scene exported as GLB.');
        },
        (error) => {
            console.error('[TC] GLB export error:', error);
            alert('Error exporting GLB. Check console for details.');
        },
        { binary: true, animations: [], trrExtras: false } 
    );
  }, []);

  useImperativeHandle(ref, () => ({ exportGLB, importGLB }), [exportGLB, importGLB]);

  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;
    const initialAppState = appStateRef.current;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    if (initialAppState.sky?.color) {
      scene.background = new THREE.Color(initialAppState.sky.color);
    }

    const camera = new THREE.PerspectiveCamera(initialAppState.cameraConfig.fov, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
    camera.position.set(initialAppState.cameraConfig.position.x, initialAppState.cameraConfig.position.y, initialAppState.cameraConfig.position.z);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.sortObjects = false; 
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 1, 0);
    controls.update();
    controlsRef.current = controls;

    const handleControlsChange = () => {
        if (cameraRef.current && controlsRef.current && appStateRef.current) {
            const currentCamPos = cameraRef.current.position;
            const oldConf = appStateRef.current.cameraConfig;
            if (
                Math.abs(oldConf.position.x - currentCamPos.x) > 0.01 ||
                Math.abs(oldConf.position.y - currentCamPos.y) > 0.01 ||
                Math.abs(oldConf.position.z - currentCamPos.z) > 0.01 ||
                oldConf.fov !== cameraRef.current.fov
            ) {
                onUpdateCameraConfig({
                    id: oldConf.id,
                    type: SceneObjectType.Camera,
                    position: {
                        x: parseFloat(currentCamPos.x.toFixed(2)),
                        y: parseFloat(currentCamPos.y.toFixed(2)),
                        z: parseFloat(currentCamPos.z.toFixed(2))
                    },
                    fov: cameraRef.current.fov,
                });
            }
        }
    };
    controls.addEventListener('end', handleControlsChange);

    const ambientLightObj = new THREE.AmbientLight(initialAppState.ambientLight.color, initialAppState.ambientLight.intensity);
    ambientLightObj.uuid = initialAppState.ambientLight.id; 
    ambientLightObj.name = initialAppState.ambientLight.name;
    scene.add(ambientLightObj);

    if (initialAppState.terrain) {
        const terrainConfig = initialAppState.terrain;
        const terrainGeometry = new THREE.PlaneGeometry(terrainConfig.size, terrainConfig.size, terrainConfig.segments, terrainConfig.segments);
        const terrainMaterial = new THREE.MeshStandardMaterial({ color: terrainConfig.color, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2 });
        const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.receiveShadow = true;
        terrainMesh.uuid = terrainConfig.id; 
        terrainMesh.name = 'terrain_mesh'; 
        applyTerrainHeight(terrainMesh.geometry as THREE.PlaneGeometry, terrainConfig);
        scene.add(terrainMesh);
    }

    if (!gizmoObjectRef.current) {
      gizmoObjectRef.current = new THREE.Group();
      gizmoObjectRef.current.name = "TransformGizmo";
      const gizmoX = createAxisGizmo('x', 0xff0000);
      const gizmoY = createAxisGizmo('y', 0x00ff00);
      const gizmoZ = createAxisGizmo('z', 0x0000ff);
      gizmoObjectRef.current.add(gizmoX, gizmoY, gizmoZ);
      scene.add(gizmoObjectRef.current);
      gizmoObjectRef.current.visible = false;
    }


    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();

      if (gizmoObjectRef.current && gizmoObjectRef.current.visible && cameraRef.current) {
        const distance = gizmoObjectRef.current.position.distanceTo(cameraRef.current.position);
        const scale = distance * GIZMO_SCALE_ADJUST_FACTOR;
        gizmoObjectRef.current.scale.set(scale, scale, scale);
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
        if (cameraRef.current && rendererRef.current && mountRef.current) {
            cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        }
    };
    window.addEventListener('resize', handleResize);
    
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !mountRef.current || !cameraRef.current || !sceneRef.current || !controlsRef.current) return;

      const rect = mountRef.current.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

      if (gizmoObjectRef.current && gizmoObjectRef.current.visible && appStateRef.current.selectedObjectIds.length === 1) {
        const gizmoHandles: THREE.Object3D[] = [];
        gizmoObjectRef.current.children.forEach(axisGroup => {
            axisGroup.children.forEach(handle => gizmoHandles.push(handle));
        });

        const intersectsGizmo = raycasterRef.current.intersectObjects(gizmoHandles);
        if (intersectsGizmo.length > 0) {
          const hitHandle = intersectsGizmo[0].object;
          if (hitHandle.userData.type === 'gizmo-handle' && hitHandle.userData.axis) {
            isGizmoDraggingRef.current = true;
            selectedGizmoAxisRef.current = hitHandle.userData.axis as 'x' | 'y' | 'z';
            controlsRef.current.enabled = false;

            const selectedAppObjectId = appStateRef.current.selectedObjectIds[0];
            draggedThreeObjectRef.current = sceneRef.current.getObjectByProperty('appId', selectedAppObjectId) || sceneRef.current.getObjectByProperty('uuid', selectedAppObjectId);

            if (draggedThreeObjectRef.current && cameraRef.current) {
              // Ensure world matrices are up-to-date before calculations
              draggedThreeObjectRef.current.updateWorldMatrix(true, false);
              if (draggedThreeObjectRef.current.parent) {
                draggedThreeObjectRef.current.parent.updateWorldMatrix(true, false);
              }

              const worldPosition = new THREE.Vector3();
              draggedThreeObjectRef.current.getWorldPosition(worldPosition);
              selectedObjectInitialPositionRef.current.copy(worldPosition);
              // console.log('[HPD] selectedObjectInitialWorldPosition:', worldPosition.clone());

              const axisDir = new THREE.Vector3(); // This is in World Space as Gizmo is not rotated with object
              if (selectedGizmoAxisRef.current === 'x') axisDir.set(1, 0, 0);
              else if (selectedGizmoAxisRef.current === 'y') axisDir.set(0, 1, 0);
              else axisDir.set(0, 0, 1);
              dragLineDirectionRef.current.copy(axisDir);
              // console.log('[HPD] dragLineDirection:', dragLineDirectionRef.current.clone());
              
              const camera = cameraRef.current;
              const cameraPosition = new THREE.Vector3();
              camera.getWorldPosition(cameraPosition);
              
              // Robust plane normal calculation (plane contains drag axis)
              // Normal is component of objectToCameraDir perpendicular to drag axis
              const objectToCameraDir = new THREE.Vector3().subVectors(cameraPosition, worldPosition).normalize();
              const d_dot_objectToCameraDir = dragLineDirectionRef.current.dot(objectToCameraDir);
              const planeNormal = new THREE.Vector3();

              if (Math.abs(d_dot_objectToCameraDir) > 0.999) { // Drag axis is collinear with object-to-camera vector
                  let cameraUp = new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
                  planeNormal.crossVectors(dragLineDirectionRef.current, cameraUp).normalize();
                  if (planeNormal.lengthSq() < 0.01) { // drag axis also aligned with cameraUp
                      let cameraRight = new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
                      planeNormal.crossVectors(dragLineDirectionRef.current, cameraRight).normalize();
                  }
              } else {
                  planeNormal.subVectors(objectToCameraDir, dragLineDirectionRef.current.clone().multiplyScalar(d_dot_objectToCameraDir)).normalize();
              }
              
              dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNormal, worldPosition);
              // console.log('[HPD] dragPlaneNormal:', planeNormal.clone());

              const intersectionPoint = new THREE.Vector3();
              if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersectionPoint)) {
                  dragStartOffsetOnPlaneRef.current.copy(intersectionPoint);
                  // console.log('[HPD] dragStartOffsetOnPlane (intersect):', dragStartOffsetOnPlaneRef.current.clone());
              } else {
                  // Fallback if ray is parallel to the plane (should be rare with new normal logic)
                  // Project object's center onto the ray.
                  const ray = raycasterRef.current.ray;
                  const t = ray.direction.dot(new THREE.Vector3().subVectors(worldPosition, ray.origin));
                  intersectionPoint.copy(ray.origin).addScaledVector(ray.direction, t);
                  dragStartOffsetOnPlaneRef.current.copy(intersectionPoint);
                  // console.warn("[Gizmo Drag] Ray parallel to drag plane, using fallback intersection."); // Keep warns active
                  // console.log('[HPD] dragStartOffsetOnPlane (fallback):', dragStartOffsetOnPlaneRef.current.clone());
              }
            }
            return; 
          }
        }
      }

      const isMultiSelectKeyHeld = event.shiftKey;
      const intersectableThreeObjects: THREE.Object3D[] = [];
      const currentClickAppState = appStateRef.current;

      if (currentClickAppState.terrain) {
        const terrainSceneMesh = sceneRef.current.getObjectByProperty('uuid', currentClickAppState.terrain.id);
        if (terrainSceneMesh) intersectableThreeObjects.push(terrainSceneMesh);
      }
      currentClickAppState.sceneObjects.forEach(so => {
        const objInScene = sceneRef.current?.getObjectByProperty('appId', so.id) || sceneRef.current?.getObjectByProperty('uuid', so.id);
        if (objInScene && (objInScene instanceof THREE.Mesh || objInScene instanceof THREE.Group || objInScene.userData.isImportedGLB)) {
            intersectableThreeObjects.push(objInScene);
        }
      });
      lightHelpersRef.current.forEach(helper => intersectableThreeObjects.push(helper));
      const intersects = raycasterRef.current.intersectObjects(intersectableThreeObjects, true); 
      
      if (intersects.length > 0) {
        let hitObject = intersects[0].object;
        let directlyHitAppManagedId: string | null = null;
        let currentTraversal: THREE.Object3D | null = hitObject;
        
        while (currentTraversal && currentTraversal !== sceneRef.current) {
          const objNodeId = currentTraversal.userData.appId || currentTraversal.uuid;
          if (currentClickAppState.sceneObjects.some(so => so.id === objNodeId)) {
            directlyHitAppManagedId = objNodeId; break;
          }
          let foundHelperLightId: string | null = null;
          for (const [lightId, helperInstance] of lightHelpersRef.current.entries()) {
            if (helperInstance === currentTraversal || helperInstance.children.includes(currentTraversal)) { 
                if (currentClickAppState.sceneObjects.some(so => so.id === lightId && (so.type === SceneObjectType.PointLight || so.type === SceneObjectType.DirectionalLight))) {
                    foundHelperLightId = lightId; break;
                }
            }
          }
          if (foundHelperLightId) { directlyHitAppManagedId = foundHelperLightId; break; }
          if (currentClickAppState.terrain && currentTraversal.uuid === currentClickAppState.terrain.id) {
            directlyHitAppManagedId = currentClickAppState.terrain.id; break;
          }
          currentTraversal = currentTraversal.parent;
        }

        let finalSelectedIdToReport = directlyHitAppManagedId;
        if (directlyHitAppManagedId) {
            let currentAppObjectIdInHierarchy = directlyHitAppManagedId;
            // eslint-disable-next-line no-constant-condition
            while (true) { 
                const appObject = currentClickAppState.sceneObjects.find(so => so.id === currentAppObjectIdInHierarchy);
                const parentIdInAppState = appObject?.parentId;
                if (parentIdInAppState) {
                    const parentGroupInAppState = currentClickAppState.sceneObjects.find(so => so.id === parentIdInAppState && so.type === SceneObjectType.Group);
                    if (parentGroupInAppState) {
                        currentAppObjectIdInHierarchy = parentGroupInAppState.id; 
                        finalSelectedIdToReport = parentGroupInAppState.id; 
                    } else { break; }
                } else { break; }
            }
        }
        onSelectObject(finalSelectedIdToReport, isMultiSelectKeyHeld);
      } else {
        onSelectObject(null, isMultiSelectKeyHeld);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isGizmoDraggingRef.current && selectedGizmoAxisRef.current && draggedThreeObjectRef.current && cameraRef.current && mountRef.current && sceneRef.current) {
        const rect = mountRef.current.getBoundingClientRect();
        mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

        const currentPointOnPlane = new THREE.Vector3();
        if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, currentPointOnPlane)) {
          // console.log('[HPM] currentPointOnPlane:', currentPointOnPlane.clone());
          const moveVectorOnPlane = new THREE.Vector3().subVectors(currentPointOnPlane, dragStartOffsetOnPlaneRef.current);
          // console.log('[HPM] moveVectorOnPlane:', moveVectorOnPlane.clone());
          const projectedMovement = moveVectorOnPlane.projectOnVector(dragLineDirectionRef.current);
          // console.log('[HPM] projectedMovement:', projectedMovement.clone());
          
          const newWorldPosition = new THREE.Vector3().copy(selectedObjectInitialPositionRef.current).add(projectedMovement);
          // console.log('[HPM] newWorldPosition:', newWorldPosition.clone());
          
          const objectToMove = draggedThreeObjectRef.current;
          if (objectToMove.parent && objectToMove.parent !== sceneRef.current) {
            const parent = objectToMove.parent;
            parent.updateWorldMatrix(true, false); 
            const parentInverseWorldMatrix = parent.matrixWorld.clone().invert();
            const newLocalPosition = newWorldPosition.clone().applyMatrix4(parentInverseWorldMatrix);
            // console.log('[HPM] newLocalPosition:', newLocalPosition.clone());
            objectToMove.position.copy(newLocalPosition);
          } else {
            objectToMove.position.copy(newWorldPosition);
          }
          
          if(gizmoObjectRef.current) {
            gizmoObjectRef.current.position.copy(newWorldPosition);
          }
        }
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0 && isGizmoDraggingRef.current) return; 

      if (isGizmoDraggingRef.current && selectedGizmoAxisRef.current && draggedThreeObjectRef.current && controlsRef.current && appStateRef.current && sceneRef.current) {
        const finalWorldPosition = new THREE.Vector3();
        draggedThreeObjectRef.current.getWorldPosition(finalWorldPosition); 
        // console.log('[HPU] finalWorldPosition:', finalWorldPosition.clone());
        
        const sceneObjectData = appStateRef.current.sceneObjects.find(obj => obj.id === (draggedThreeObjectRef.current!.userData.appId || draggedThreeObjectRef.current!.uuid) );

        if (sceneObjectData) {
          let positionForApp: AppVector3;

          if (sceneObjectData.parentId) {
              const parentThreeObject = sceneRef.current.getObjectByProperty('appId', sceneObjectData.parentId) || sceneRef.current.getObjectByProperty('uuid', sceneObjectData.parentId);
              if (parentThreeObject) {
                  parentThreeObject.updateWorldMatrix(true, false);
                  const parentWorldMatrixInverse = parentThreeObject.matrixWorld.clone().invert();
                  const localPosition = finalWorldPosition.clone().applyMatrix4(parentWorldMatrixInverse);
                  // console.log('[HPU] localPosition (before parseFloat):', localPosition.clone());
                  positionForApp = { x: parseFloat(localPosition.x.toFixed(2)), y: parseFloat(localPosition.y.toFixed(2)), z: parseFloat(localPosition.z.toFixed(2)) };
              } else { 
                  // console.warn(`[HPU] Parent object ${sceneObjectData.parentId} not found in Three.js scene. Using world position.`); // Keep warns active
                  positionForApp = { x: parseFloat(finalWorldPosition.x.toFixed(2)), y: parseFloat(finalWorldPosition.y.toFixed(2)), z: parseFloat(finalWorldPosition.z.toFixed(2)) };
              }
          } else {
             positionForApp = { x: parseFloat(finalWorldPosition.x.toFixed(2)), y: parseFloat(finalWorldPosition.y.toFixed(2)), z: parseFloat(finalWorldPosition.z.toFixed(2)) };
          }
          // console.log('[HPU] positionForApp:', positionForApp);

          const newTransform: Transform = {
              position: positionForApp,
              rotation: { ...sceneObjectData.transform.rotation }, 
              scale: { ...sceneObjectData.transform.scale }
          };
          onUpdateObjectTransform(sceneObjectData.id, newTransform);
        }
      }
      
      isGizmoDraggingRef.current = false;
      selectedGizmoAxisRef.current = null;
      draggedThreeObjectRef.current = null;
      if (controlsRef.current) controlsRef.current.enabled = true;
    };
    
    currentMount.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove); 
    window.addEventListener('pointerup', handlePointerUp);     

    return () => {
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('end', handleControlsChange);
      controls.dispose();
      
      currentMount.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      selectionHelpersRef.current.forEach(helper => { sceneRef.current?.remove(helper); helper.dispose(); });
      selectionHelpersRef.current.clear();
      lightHelpersRef.current.forEach(helper => { sceneRef.current?.remove(helper); helper.dispose(); });
      lightHelpersRef.current.clear();
      
      if (gizmoObjectRef.current) {
        sceneRef.current?.remove(gizmoObjectRef.current);
        gizmoObjectRef.current.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).geometry?.dispose();
                ((child as THREE.Mesh).material as THREE.Material)?.dispose();
            }
        });
        gizmoObjectRef.current = null;
      }

      if (rendererRef.current) rendererRef.current.dispose();
      sceneRef.current?.traverse(object => {
          if ((object as THREE.Mesh).isMesh) {
              if ((object as THREE.Mesh).geometry) (object as THREE.Mesh).geometry.dispose();
              const materialToDispose = (object as THREE.Mesh).material as THREE.Material | THREE.Material[];
              if (materialToDispose) {
                  if (Array.isArray(materialToDispose)) {
                      materialToDispose.forEach(mat => { if ('map' in mat && (mat as any).map instanceof THREE.Texture) { (mat as any).map.dispose(); } mat.dispose(); });
                  } else {
                      if ('map' in materialToDispose && (materialToDispose as any).map instanceof THREE.Texture) { (materialToDispose as any).map.dispose(); }
                      materialToDispose.dispose();
                  }
              }
          }
      });
      cancelAnimationFrame(animationFrameId);
      if (currentMount && rendererRef.current?.domElement) {
        currentMount.removeChild(rendererRef.current.domElement);
      }
      sceneRef.current = null; cameraRef.current = null; rendererRef.current = null; controlsRef.current = null;
    };
  }, [onSelectObject, onUpdateCameraConfig, onUpdateObjectTransform]); 


  const applyTerrainHeight = (geometry: THREE.PlaneGeometry, config: TerrainConfig) => {
    const positions = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i); 
        let yPos = 0; 
        switch (config.heightGenerationMethod) {
            case HeightGenerationMethod.SimplexNoise:
                if (config.noiseAmplitude > 0) { 
                    yPos = simplexNoise.noise2D( (vertex.x / config.size) * config.segments * config.noiseScale, (vertex.y / config.size) * config.segments * config.noiseScale ) * config.noiseAmplitude;
                }
                break;
            case HeightGenerationMethod.SineWave:
                 if (config.sineAmplitude > 0) { 
                    yPos = Math.sin(vertex.x * config.sineFrequencyX) * Math.cos(vertex.y * config.sineFrequencyZ) * config.sineAmplitude;
                 }
                break;
            case HeightGenerationMethod.Flat: default: yPos = 0; break;
        }
        positions.setZ(i, yPos); 
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current || !appState) return;
    const currentScene = sceneRef.current;
    const currentCamera = cameraRef.current;

    const sceneObjectMapById = new Map(appState.sceneObjects.map(obj => [obj.id, obj]));


    if (currentScene.background instanceof THREE.Color) {
        if (currentScene.background.getHexString() !== appState.sky.color.substring(1)) currentScene.background.set(appState.sky.color);
    } else { currentScene.background = new THREE.Color(appState.sky.color); }

    const camPosChanged = Math.abs(currentCamera.position.x - appState.cameraConfig.position.x) > 0.01 || Math.abs(currentCamera.position.y - appState.cameraConfig.position.y) > 0.01 || Math.abs(currentCamera.position.z - appState.cameraConfig.position.z) > 0.01;
    if (camPosChanged) currentCamera.position.set(appState.cameraConfig.position.x, appState.cameraConfig.position.y, appState.cameraConfig.position.z);
    if (currentCamera.fov !== appState.cameraConfig.fov) { currentCamera.fov = appState.cameraConfig.fov; currentCamera.updateProjectionMatrix(); }

    const ambientLightThree = currentScene.getObjectByProperty('uuid', appState.ambientLight.id) as THREE.AmbientLight | undefined;
    if (ambientLightThree) {
      if (ambientLightThree.color.getHexString() !== appState.ambientLight.color.substring(1)) ambientLightThree.color.set(appState.ambientLight.color);
      if (ambientLightThree.intensity !== appState.ambientLight.intensity) ambientLightThree.intensity = appState.ambientLight.intensity;
    }

    const terrainMeshInScene = currentScene.getObjectByProperty('uuid', TERRAIN_ID) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | undefined;
    if (appState.terrain) {
        const terrainConfig = appState.terrain;
        if (terrainMeshInScene) {
            let geometryNeedsRebuild = false; const currentGeomParams = terrainMeshInScene.geometry.parameters;
            if (currentGeomParams.width !== terrainConfig.size || currentGeomParams.height !== terrainConfig.size || currentGeomParams.widthSegments !== terrainConfig.segments || currentGeomParams.heightSegments !== terrainConfig.segments) geometryNeedsRebuild = true;
            if (geometryNeedsRebuild) { terrainMeshInScene.geometry.dispose(); terrainMeshInScene.geometry = new THREE.PlaneGeometry(terrainConfig.size, terrainConfig.size, terrainConfig.segments, terrainConfig.segments); }
            applyTerrainHeight(terrainMeshInScene.geometry, terrainConfig);
            if (terrainMeshInScene.material.color.getHexString() !== terrainConfig.color.substring(1)) terrainMeshInScene.material.color.set(terrainConfig.color);
        } else { 
            const newTerrainGeometry = new THREE.PlaneGeometry(terrainConfig.size, terrainConfig.size, terrainConfig.segments, terrainConfig.segments);
            const newTerrainMaterial = new THREE.MeshStandardMaterial({ color: terrainConfig.color, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2 });
            const newTerrainMesh = new THREE.Mesh(newTerrainGeometry, newTerrainMaterial);
            newTerrainMesh.rotation.x = -Math.PI / 2; newTerrainMesh.receiveShadow = true; newTerrainMesh.uuid = terrainConfig.id; newTerrainMesh.name = 'terrain_mesh';
            applyTerrainHeight(newTerrainMesh.geometry, terrainConfig);
            currentScene.add(newTerrainMesh);
        }
    } else { 
        if (terrainMeshInScene) { currentScene.remove(terrainMeshInScene); terrainMeshInScene.geometry.dispose(); terrainMeshInScene.material.dispose(); }
    }

    const threeObjectMap = new Map<string, THREE.Object3D>();
    appState.sceneObjects.forEach(objData => {
        let threeObj = currentScene.getObjectByProperty('appId', objData.id) || currentScene.getObjectByProperty('uuid', objData.id);
        let lightHelperForThisObject = lightHelpersRef.current.get(objData.id);

        if (!threeObj) { 
            if (objData.type === SceneObjectType.Mesh) {
                const meshData = objData as MeshObject; let geometry: THREE.BufferGeometry;
                switch (meshData.shape) {
                    case ShapeType.Cube: geometry = new THREE.BoxGeometry(1, 1, 1); break;
                    case ShapeType.Sphere: geometry = new THREE.SphereGeometry(0.5, 32, 16); break;
                    case ShapeType.Cylinder: geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
                    case ShapeType.Cone: geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
                    case ShapeType.Plane: geometry = new THREE.PlaneGeometry(1, 1); break;
                    default: geometry = new THREE.BoxGeometry(1, 1, 1);
                }
                const material = new THREE.MeshStandardMaterial({ color: meshData.color, roughness: 0.5, metalness: 0.1 });
                threeObj = new THREE.Mesh(geometry, material);
                (threeObj as THREE.Mesh).castShadow = true; (threeObj as THREE.Mesh).receiveShadow = true;
            } else if (objData.type === SceneObjectType.PointLight) {
                const lightData = objData as PointLightObject;
                threeObj = new THREE.PointLight(lightData.color, lightData.intensity);
                (threeObj as THREE.PointLight).castShadow = true;
                if (!lightHelperForThisObject) {
                    const newHelper = new THREE.PointLightHelper(threeObj as THREE.PointLight, 0.2);
                    newHelper.userData.isHelper = true; newHelper.userData.appId = objData.id; 
                    lightHelpersRef.current.set(objData.id, newHelper); lightHelperForThisObject = newHelper;
                }
            } else if (objData.type === SceneObjectType.DirectionalLight) {
                const lightData = objData as DirectionalLightObject;
                threeObj = new THREE.DirectionalLight(lightData.color, lightData.intensity);
                (threeObj as THREE.DirectionalLight).castShadow = true;
                Object.assign((threeObj as THREE.DirectionalLight).shadow.mapSize, {width: 1024, height: 1024});
                Object.assign((threeObj as THREE.DirectionalLight).shadow.camera, {near:0.5, far:50, left:-10, right:10, top:10, bottom:-10});
                if (!lightHelperForThisObject) {
                    const newHelper = new THREE.DirectionalLightHelper(threeObj as THREE.DirectionalLight, 0.5);
                    newHelper.userData.isHelper = true; newHelper.userData.appId = objData.id; 
                    lightHelpersRef.current.set(objData.id, newHelper); lightHelperForThisObject = newHelper;
                }
            } else if (objData.type === SceneObjectType.Group) {
                threeObj = new THREE.Group();
            } else if (objData.type === SceneObjectType.ImportedGLB) {
                if(!threeObj) console.warn(`[TC Sync] ImportedGLB '${objData.name}' (ID: ${objData.id}) expected but not found in scene graph.`);
            }

            if (threeObj) {
                threeObj.uuid = objData.id; 
                threeObj.name = objData.name;
                threeObj.userData.appId = objData.id; 
            }
        }
        
        if (threeObj) {
            const { position, rotation, scale } = objData.transform;
            if (!threeObj.position.equals(new THREE.Vector3(position.x, position.y, position.z))) threeObj.position.set(position.x, position.y, position.z);
            const eulerRotation = new THREE.Euler(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z), 'XYZ');
            if (!threeObj.rotation.equals(eulerRotation)) threeObj.rotation.copy(eulerRotation);
            if (!threeObj.scale.equals(new THREE.Vector3(scale.x, scale.y, scale.z))) threeObj.scale.set(scale.x, scale.y, scale.z);

            if (objData.type === SceneObjectType.Mesh && threeObj instanceof THREE.Mesh) {
                const meshData = objData as MeshObject; 
                const material = threeObj.material as THREE.MeshStandardMaterial;
                if (material.color.getHexString() !== meshData.color.substring(1)) material.color.set(meshData.color);
                
                const finalOpacity = calculateEffectiveOpacity(objData.id, appState.sceneObjects, sceneObjectMapById);
                applyOpacityToMaterial(material, finalOpacity);

            } else if (objData.type === SceneObjectType.PointLight && threeObj instanceof THREE.PointLight) {
                const lightData = objData as PointLightObject;
                if (threeObj.color.getHexString() !== lightData.color.substring(1)) threeObj.color.set(lightData.color);
                if (threeObj.intensity !== lightData.intensity) threeObj.intensity = lightData.intensity;
                lightHelperForThisObject?.update();
            } else if (objData.type === SceneObjectType.DirectionalLight && threeObj instanceof THREE.DirectionalLight) {
                const lightData = objData as DirectionalLightObject;
                if (threeObj.color.getHexString() !== lightData.color.substring(1)) threeObj.color.set(lightData.color);
                if (threeObj.intensity !== lightData.intensity) threeObj.intensity = lightData.intensity;
                lightHelperForThisObject?.update();
            } else if (objData.type === SceneObjectType.ImportedGLB && threeObj instanceof THREE.Group) {
                const groupEffectiveOpacity = calculateEffectiveOpacity(objData.id, appState.sceneObjects, sceneObjectMapById);
                threeObj.traverse((node) => {
                    if ((node as THREE.Mesh).isMesh) {
                        const meshNode = node as THREE.Mesh;
                        const applyToSingleMaterial = (mat: THREE.Material, originalOpacityVal: number) => {
                            const finalMeshOpacity = originalOpacityVal * groupEffectiveOpacity;
                            applyOpacityToMaterial(mat, finalMeshOpacity);
                        };
                        
                        if (Array.isArray(meshNode.material)) {
                            const originalOpacities = (meshNode.userData.originalOpacities as number[] | undefined) ?? meshNode.material.map(m => ('opacity' in m ? (m as any).opacity : 1.0));
                            if (!meshNode.userData.originalOpacities && meshNode.material.length > 0) { 
                                meshNode.userData.originalOpacities = meshNode.material.map(m => ('opacity' in m ? (m as any).opacity : 1.0));
                            }
                            meshNode.material.forEach((mat, index) => {
                                applyToSingleMaterial(mat, originalOpacities[index] !== undefined ? originalOpacities[index] : 1.0);
                            });
                        } else if (meshNode.material) {
                            let originalOpacity = meshNode.userData.originalOpacity as number | undefined;
                            if (originalOpacity === undefined) { 
                               originalOpacity = ('opacity' in meshNode.material ? (meshNode.material as any).opacity : 1.0);
                               meshNode.userData.originalOpacity = originalOpacity;
                            }
                            applyToSingleMaterial(meshNode.material, originalOpacity);
                        }
                    }
                });
            }
            threeObjectMap.set(objData.id, threeObj);
        }
    });
    
    const appStateObjectIds = new Set(appState.sceneObjects.map(obj => obj.id));
    const objectsToRemoveFromScene: THREE.Object3D[] = [];
    currentScene.traverse(objInGraph => {
        const id = objInGraph.userData.appId || objInGraph.uuid;
        if (id && typeof id === 'string' && (objInGraph.userData.appId || appStateObjectIds.has(id)) ) { 
            if (!appStateObjectIds.has(id) && 
                objInGraph !== currentScene &&
                objInGraph !== currentCamera &&
                objInGraph.uuid !== appState.ambientLight.id &&
                (appState.terrain ? objInGraph.uuid !== appState.terrain.id : true) && 
                !objInGraph.userData.isHelper && objInGraph !== gizmoObjectRef.current ) {
                objectsToRemoveFromScene.push(objInGraph);
            }
        }
    });

    objectsToRemoveFromScene.forEach(objToRemove => {
        objToRemove.parent?.remove(objToRemove); 
        if ((objToRemove as THREE.Mesh).isMesh) {
            const mesh = objToRemove as THREE.Mesh;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
            else mesh.material?.dispose();
        }
        const helperIdToRemove = objToRemove.userData.appId || objToRemove.uuid;
        const helper = lightHelpersRef.current.get(helperIdToRemove);
        if(helper){ helper.parent?.remove(helper); helper.dispose(); lightHelpersRef.current.delete(helperIdToRemove); }
        threeObjectMap.delete(helperIdToRemove); 
    });
    
    appState.sceneObjects.forEach(objData => {
        const threeObj = threeObjectMap.get(objData.id);
        if (!threeObj) {
            return;
        }

        const desiredParentId = objData.parentId;
        const targetParentThreeObject = desiredParentId ? threeObjectMap.get(desiredParentId) : currentScene;

        if (targetParentThreeObject) {
            if (threeObj.parent !== targetParentThreeObject) {
                targetParentThreeObject.add(threeObj); 
            }
        } else if (desiredParentId) { 
            console.warn(`[TC Sync] Specified parent ${desiredParentId} for ${objData.id} not found. Adding to scene root.`);
            if (threeObj.parent !== currentScene) currentScene.add(threeObj);
        } else { 
             if (threeObj.parent !== currentScene && threeObj.parent !== null) { 
                currentScene.add(threeObj); 
             } else if (threeObj.parent === null) { 
                currentScene.add(threeObj);
             }
        }
        
        const lightHelper = lightHelpersRef.current.get(objData.id);
        if(lightHelper && lightHelper.parent !== currentScene && threeObj.parent === currentScene) { 
            currentScene.add(lightHelper);
        } else if (lightHelper && threeObj.parent !== currentScene && lightHelper.parent === currentScene) { 
            currentScene.remove(lightHelper);
        } else if (lightHelper && lightHelper.parent !== currentScene) { 
            currentScene.add(lightHelper)
        }
    });

    const currentLightObjectIds = new Set(appState.sceneObjects.filter(so => so.type === SceneObjectType.PointLight || so.type === SceneObjectType.DirectionalLight).map(so => so.id));
    lightHelpersRef.current.forEach((helper, id) => {
        if (!currentLightObjectIds.has(id)) { 
            helper.parent?.remove(helper); helper.dispose(); lightHelpersRef.current.delete(id); 
        }
    });

    const currentSelectedIds = new Set(appState.selectedObjectIds);
    selectionHelpersRef.current.forEach((helper, id) => {
      if (!currentSelectedIds.has(id)) { currentScene.remove(helper); helper.dispose(); selectionHelpersRef.current.delete(id); }
    });

    appState.selectedObjectIds.forEach(id => {
      const appStateItem = appState.sceneObjects.find(so => so.id === id) || (appState.terrain && appState.terrain.id === id ? appState.terrain : null);
      const canHaveBoxHelper = appStateItem && (appStateItem.type === SceneObjectType.Mesh || appStateItem.type === SceneObjectType.Group || appStateItem.type === SceneObjectType.ImportedGLB);

      if (canHaveBoxHelper) {
          const threeObj = threeObjectMap.get(id); 
          if (threeObj) {
            let helper = selectionHelpersRef.current.get(id);
            if (helper) {
              if (helper.userData.helpedObjectInstanceId !== threeObj.id) {
                currentScene.remove(helper);
                helper.dispose();
                helper = new THREE.BoxHelper(threeObj, 0xffff00);
                helper.userData.isHelper = true;
                helper.userData.helpedObjectInstanceId = threeObj.id; 
                currentScene.add(helper);
                selectionHelpersRef.current.set(id, helper);
              } else {
                helper.update(); 
              }
            } else {
              helper = new THREE.BoxHelper(threeObj, 0xffff00);
              helper.userData.isHelper = true;
              helper.userData.helpedObjectInstanceId = threeObj.id; 
              currentScene.add(helper);
              selectionHelpersRef.current.set(id, helper);
            }
          } else {
            const helperToRemove = selectionHelpersRef.current.get(id);
            if (helperToRemove) {
                currentScene.remove(helperToRemove); 
                helperToRemove.dispose(); 
                selectionHelpersRef.current.delete(id);
            }
          }
      } else { 
          const helperToRemove = selectionHelpersRef.current.get(id);
          if (helperToRemove) { 
              currentScene.remove(helperToRemove); 
              helperToRemove.dispose(); 
              selectionHelpersRef.current.delete(id); 
          }
      }
    });
    
    if (gizmoObjectRef.current) {
        if (appState.selectedObjectIds.length === 1) {
            const selectedId = appState.selectedObjectIds[0];
            const selectedItemData = appState.sceneObjects.find(obj => obj.id === selectedId);
            const canHaveGizmo = selectedItemData && 
                                 (selectedItemData.type === SceneObjectType.Mesh || 
                                  selectedItemData.type === SceneObjectType.Group || 
                                  selectedItemData.type === SceneObjectType.ImportedGLB);

            if (canHaveGizmo) {
                const threeObj = threeObjectMap.get(selectedId);
                if (threeObj) {
                    const worldPos = new THREE.Vector3();
                    threeObj.getWorldPosition(worldPos); 
                    gizmoObjectRef.current.position.copy(worldPos);
                    gizmoObjectRef.current.visible = true;
                } else {
                    gizmoObjectRef.current.visible = false;
                }
            } else {
                gizmoObjectRef.current.visible = false;
            }
        } else {
            gizmoObjectRef.current.visible = false;
        }
    }
    currentScene.updateMatrixWorld(true);

  }, [appState]); 

  return <div ref={mountRef} className="w-full h-full" id="three-canvas-container" />;
});

export default ThreeCanvas;
