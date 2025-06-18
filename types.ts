import * as THREE from 'three';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vector3;
  rotation: Vector3; // Euler angles in degrees
  scale: Vector3;
}

export enum SceneObjectType {
  Mesh = 'Mesh',
  PointLight = 'PointLight',
  DirectionalLight = 'DirectionalLight',
  AmbientLight = 'AmbientLight',
  Sky = 'Sky',
  Terrain = 'Terrain',
  Camera = 'Camera',
  Group = 'Group',
  ImportedGLB = 'ImportedGLB',
}

export enum ShapeType {
  Cube = 'Cube',
  Sphere = 'Sphere',
  Cylinder = 'Cylinder',
  Cone = 'Cone',
  Plane = 'Plane',
}

export interface BaseSceneObject {
  id: string; // UUID
  name: string;
  type: SceneObjectType;
  transform: Transform;
  parentId?: string; // ID of the parent group, if any
  opacity?: number; // Optional: 0.0 (transparent) to 1.0 (opaque), defaults to 1.0
}

export interface MeshObject extends BaseSceneObject {
  type: SceneObjectType.Mesh;
  shape: ShapeType;
  color: string; // hex color
}

export interface LightProperties {
  color: string; // hex color
  intensity: number;
}

export interface PointLightObject extends BaseSceneObject, LightProperties {
  type: SceneObjectType.PointLight;
}

export interface DirectionalLightObject extends BaseSceneObject, LightProperties {
  type: SceneObjectType.DirectionalLight;
}

export interface AmbientLightObject extends Omit<BaseSceneObject, 'transform' | 'parentId' | 'opacity'>, LightProperties {
  id: string;
  name: string;
  type: SceneObjectType.AmbientLight;
}

export interface GroupObject extends BaseSceneObject {
  type: SceneObjectType.Group;
  childIds: string[];
}

export interface ImportedGLBObject extends BaseSceneObject {
  type: SceneObjectType.ImportedGLB;
}

export type SceneObject = MeshObject | PointLightObject | DirectionalLightObject | GroupObject | ImportedGLBObject;

export interface SkyConfig {
  id: 'sky_config';
  type: SceneObjectType.Sky;
  color: string;
}

export enum TerrainShape { // Retained for conceptual clarity, though always Plane for now.
  Plane = 'Plane',
}

export enum HeightGenerationMethod {
  Flat = 'Flat',
  SimplexNoise = 'SimplexNoise',
  SineWave = 'SineWave',
}

export interface TerrainConfig {
  id: 'terrain_config';
  type: SceneObjectType.Terrain;
  shape: TerrainShape.Plane; // Currently always Plane
  size: number;
  color: string;
  segments: number; // Number of segments for width and height of the plane
  heightGenerationMethod: HeightGenerationMethod;
  // Simplex Noise parameters
  noiseScale: number;
  noiseAmplitude: number;
  // Sine Wave parameters
  sineFrequencyX: number;
  sineFrequencyZ: number;
  sineAmplitude: number;
}

export interface CameraConfig {
  id: 'camera_config';
  type: SceneObjectType.Camera;
  position: Vector3;
  fov: number;
}

export type SelectableItem = SceneObject | SkyConfig | TerrainConfig | CameraConfig | AmbientLightObject;

export interface AppState {
  sceneObjects: SceneObject[];
  ambientLight: AmbientLightObject;
  sky: SkyConfig;
  terrain: TerrainConfig | null; // Allow terrain to be null
  cameraConfig: CameraConfig;
  selectedObjectIds: string[];
  isLoading: boolean;
}

// Props for specific controls
export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  unit?: string;
  id?: string;
}

export interface ColorPickerProps {
  label: string;
  color: string;
  onChange: (color: string) => void;
  id?: string;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'default';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export interface IconProps {
  className?: string;
}

// Prop types for ThreeCanvas
export interface ThreeCanvasProps {
  appState: AppState;
  onSelectObject: (id: string | null, isMultiSelectKeyHeld: boolean) => void;
  onUpdateCameraConfig: (newConfig: CameraConfig) => void;
  onUpdateObjectTransform: (objectId: string, newTransform: Transform) => void; // Added for direct manipulation
}
