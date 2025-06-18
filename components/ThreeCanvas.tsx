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
const GIZMO_SCALE_ADJUST_FACTOR = 0.1; // Lower values make gizmo smaller relative to distance
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
  
    // Using MeshBasicMaterial for gizmo to ensure it's not affected by scene lighting
    // and depthTest:false to ensure it's always visible.
    const material = new THREE.MeshBasicMaterial({ 
      color, 
      depthTest: false, 
      transparent: true, 
      opacity: 0.85,
      // Set renderOrder to ensure gizmo renders on top, if multiple depthTest:false items.
      // Higher numbers render later (on top).
      renderOrder: 999 
    });
  
    const cone = new THREE.Mesh(coneGeometry, material);
    const cylinder = new THREE.Mesh(cylinderGeometry, material);

    // Position cylinder shaft starting from origin up to just before cone
    cylinder.position.y = cylinderLength / 2;
    // Position cone at the end of the shaft
    cone.position.y = cylinderLength + GIZMO_CONE_HEIGHT / 2;

    group.add(cylinder);
    group.add(cone);
  
    // UserData to identify for raycasting
    cylinder.userData = { type: 'gizmo-handle', axis };
    cone.userData = { type: 'gizmo-handle', axis };
    group.userData = { type: 'gizmo-handle-group', axis};

    if (axis === 'x') {
      group.rotation.z = -Math.PI / 2;
    } else if (axis === 'z') {
      group.rotation.x = Math.PI / 2;
    }
    // Y is already upright

    return group;
}
// --- End Gizmo Configuration ---

const TERRAIN_VERTEX_SHADER = `
    varying vec2 vUv;
    varying vec3 vPosition;
  
    void main() {
      vUv = uv;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const TERRAIN_FRAGMENT_SHADER = `
    uniform vec3 color1;
    uniform vec3 color2;
    uniform float mixFactor;
    uniform int mixPattern;
  
    varying vec2 vUv;
    varying vec3 vPosition;
  
    // Função de ruído simples
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }
  
    void main() {
      float mixValue = 0.0;
    
      if (mixPattern == 0) {
        // Gradiente horizontal
        mixValue = vUv.x;
      } else if (mixPattern == 1) {
        // Ruído
        mixValue = random(vUv * 10.0);
      } else if (mixPattern == 2) {
        // Xadrez
        float checker = step(0.5, mod(floor(vUv.x * 8.0) + floor(vUv.y * 8.0), 2.0));
        mixValue = checker;
      }
    
      // Aplicar o fator de mistura
      mixValue = mix(0.0, mixValue, mixFactor);
    
      vec3 finalColor = mix(color1, color2, mixValue);
      gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// Função para criar material do terreno:
function createTerrainMaterial(config: TerrainConfig): THREE.ShaderMaterial {
    const color1 = new THREE.Color(config.color1);
    const color2 = new THREE.Color(config.color2);
  
    const patternMap = {
      'gradient': 0,
      'noise': 1,
      'checkerboard': 2
    };
  
    return new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERTEX_SHADER,
      fragmentShader: TERRAIN_FRAGMENT_SHADER,
      uniforms: {
        color1: { value: color1 },
        color2: { value: color2 },
        mixFactor: { value: config.mixFactor },
        mixPattern: { value: patternMap[config.mixPattern] }
      }
    });
}

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

    // --- Gizmo State Refs ---
    const gizmoObjectRef = useRef<THREE.Group | null>(null);
    const isGizmoDraggingRef = useRef<boolean>(false);
    const selectedGizmoAxisRef = useRef<'x' | 'y' | 'z' | null>(null);
    const draggedThreeObjectRef = useRef<THREE.Object3D | null>(null); // The actual scene object being moved
  
    const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane()); // Plane for gizmo interaction
    const dragLineDirectionRef = useRef<THREE.Vector3>(new THREE.Vector3()); // World direction of the drag axis
    const selectedObjectInitialPositionRef = useRef<THREE.Vector3>(new THREE.Vector3()); // World pos of object at drag start
    const dragStartOffsetOnPlaneRef = useRef<THREE.Vector3>(new THREE.Vector3()); // Offset on the drag plane


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
      // Important for gizmo rendering on top of other things correctly with depthTest:false
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

      // --- Create Gizmo ---
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

        // Gizmo scaling
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
    
      // --- Unified Pointer Event Handlers ---
      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !mountRef.current || !cameraRef.current || !sceneRef.current || !controlsRef.current) return;

        const rect = mountRef.current.getBoundingClientRect();
        mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

        // 1. Gizmo Interaction Check
        if (gizmoObjectRef.current && gizmoObjectRef.current.visible && appStateRef.current.selectedObjectIds.length === 1) {
          const gizmoHandles: THREE.Object3D[] = [];
          gizmoObjectRef.current.children.forEach(axisGroup => { // these are X,Y,Z groups
              axisGroup.children.forEach(handle => gizmoHandles.push(handle)); // these are cones/cylinders
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

              if (draggedThreeObjectRef.current) {
                const worldPosition = new THREE.Vector3();
                draggedThreeObjectRef.current.getWorldPosition(worldPosition);
                selectedObjectInitialPositionRef.current.copy(worldPosition);

                const axisDir = new THREE.Vector3();
                if (selectedGizmoAxisRef.current === 'x') axisDir.set(1, 0, 0);
                else if (selectedGizmoAxisRef.current === 'y') axisDir.set(0, 1, 0);
                else axisDir.set(0, 0, 1);
                dragLineDirectionRef.current.copy(axisDir);
              
                const cameraViewDir = new THREE.Vector3();
                cameraRef.current.getWorldDirection(cameraViewDir);
              
                let planeNormal = new THREE.Vector3().crossVectors(axisDir, cameraViewDir).normalize();
                if (planeNormal.lengthSq() < 0.01) { // Axis parallel to view, choose alternative
                    const altNormalSrc = Math.abs(axisDir.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0); // Avoid self-cross
                    planeNormal = new THREE.Vector3().crossVectors(axisDir, altNormalSrc).normalize();
                }
                dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNormal, worldPosition);

                const intersectionPoint = new THREE.Vector3();
                raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersectionPoint);
                dragStartOffsetOnPlaneRef.current.copy(intersectionPoint);
              }
              return; // Gizmo interaction started, consume event
            }
          }
        }

        // 2. Object Selection Logic (if no gizmo interaction)
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
              if (helperInstance === currentTraversal || helperInstance.children.includes(currentTraversal as THREE.Object3D<THREE.Event>)) {
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
        if (isGizmoDraggingRef.current && selectedGizmoAxisRef.current && draggedThreeObjectRef.current && cameraRef.current && mountRef.current) {
          const rect = mountRef.current.getBoundingClientRect();
          mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

          const currentPointOnPlane = new THREE.Vector3();
          if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, currentPointOnPlane)) {
            const moveVectorOnPlane = new THREE.Vector3().subVectors(currentPointOnPlane, dragStartOffsetOnPlaneRef.current);
            const projectedMovement = moveVectorOnPlane.projectOnVector(dragLineDirectionRef.current);
          
            const newPosition = new THREE.Vector3().copy(selectedObjectInitialPositionRef.current).add(projectedMovement);
            draggedThreeObjectRef.current.position.copy(newPosition);
          
            if(gizmoObjectRef.current) {
              gizmoObjectRef.current.position.copy(newPosition);
            }
          }
        }
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (event.button !== 0 && isGizmoDraggingRef.current) return;

        if (isGizmoDraggingRef.current && selectedGizmoAxisRef.current && draggedThreeObjectRef.current && controlsRef.current && appStateRef.current && sceneRef.current) {
          const finalWorldPosition = new THREE.Vector3().copy(draggedThreeObjectRef.current.position);
          const sceneObjectData = appStateRef.current.sceneObjects.find(obj => obj.id === (draggedThreeObjectRef.current!.userData.appId || draggedThreeObjectRef.current!.uuid) );

          if (sceneObjectData) {
            let positionForApp: AppVector3 = { x: parseFloat(finalWorldPosition.x.toFixed(2)), y: parseFloat(finalWorldPosition.y.toFixed(2)), z: parseFloat(finalWorldPosition.z.toFixed(2)) };

            if (sceneObjectData.parentId) {
                const parentThreeObject = sceneRef.current.getObjectByProperty('appId', sceneObjectData.parentId) || sceneRef.current.getObjectByProperty('uuid', sceneObjectData.parentId);
                if (parentThreeObject) {
                    parentThreeObject.updateWorldMatrix(true, false);
                    const parentWorldMatrixInverse = parentThreeObject.matrixWorld.clone().invert();
                    const localPosition = finalWorldPosition.clone().applyMatrix4(parentWorldMatrixInverse);
                    positionForApp = { x: parseFloat(localPosition.x.toFixed(2)), y: parseFloat(localPosition.y.toFixed(2)), z: parseFloat(localPosition.z.toFixed(2)) };
                }
            }
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
              threeObj.updateMatrix(); 

              if (objData.type === SceneObjectType.Mesh && threeObj instanceof THREE.Mesh) {
                  const meshData = objData as MeshObject; const material = threeObj.material as THREE.MeshStandardMaterial;
                  if (material.color.getHexString() !== meshData.color.substring(1)) material.color.set(meshData.color);
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
                  !objInGraph.userData.isHelper && objInGraph !== gizmoObjectRef.current ) {  // Don't remove gizmo itself here
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
              if(objData.type !== SceneObjectType.ImportedGLB) { 
                    console.warn(`[TC Sync] Object ID ${objData.id} ('${objData.name}') not in threeObjectMap for parenting.`);
              }
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
        if (!selectionHelpersRef.current.has(id)) {
          const appStateItem = appState.sceneObjects.find(so => so.id === id) || (appState.terrain && appState.terrain.id === id ? appState.terrain : null);
          if (appStateItem && (appStateItem.type === SceneObjectType.Mesh || appStateItem.type === SceneObjectType.ImportedGLB || appStateItem.type === SceneObjectType.Group)) {
            const threeObjToHighlight = threeObjectMap.get(id); 
            if (threeObjToHighlight) {
              const helper = new THREE.BoxHelper(threeObjToHighlight, 0xffff00); 
              helper.userData.isHelper = true; 
              currentScene.add(helper); 
              selectionHelpersRef.current.set(id, helper);
            }
          }
        } else { 
            const helper = selectionHelpersRef.current.get(id);
            const threeObj = threeObjectMap.get(id);
            if(helper && threeObj && helper.object !== threeObj) { 
              currentScene.remove(helper); helper.dispose();
              const newHelper = new THREE.BoxHelper(threeObj, 0xffff00);
              newHelper.userData.isHelper = true; 
              currentScene.add(newHelper); 
              selectionHelpersRef.current.set(id, newHelper);
            } else if (helper) {
              helper.update();
            }
        }
      });
    
      // --- Gizmo Visibility and Positioning ---
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
