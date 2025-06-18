import React, { useState, useRef, useMemo } from 'react';
import { SceneObjectType, ShapeType, PointLightObject, DirectionalLightObject, MeshObject, SceneObject as SceneObjectTypeUnion, AppState } from '../types';
import Button from './Button';
import { CubeIcon, LightIcon, SkyIcon, UploadIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon, GroupIcon, TerrainIcon } from './icons'; // Added TerrainIcon
import * as THREE from 'three';

interface LeftSidebarProps {
  onAddItem: (item: SceneObjectTypeUnion) => void;
  onToggleSelection: (id: string, multiSelectKeyHeld?: boolean) => void;
  onImportGLB: (file: File) => void;
  onExportGLB: () => void;
  selectedObjectIds: string[];
  onCreateGroupFromSelection: () => void;
  appState: AppState; 
  onAddTerrain: () => void; // New prop to add terrain
}

const AccordionItem: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="mb-2 last:mb-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 text-left text-gray-200 bg-gray-700 hover:bg-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150"
      >
        <span className="flex items-center">
          {icon}
          <span className="ml-2 font-medium">{title}</span>
        </span>
        {isOpen ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
      </button>
      {isOpen && <div className="p-3 mt-1 bg-gray-750 rounded-md space-y-2">{children}</div>}
    </div>
  );
};

const LeftSidebar: React.FC<LeftSidebarProps> = ({ 
  onAddItem, onToggleSelection, onImportGLB, onExportGLB, 
  selectedObjectIds, onCreateGroupFromSelection, appState, onAddTerrain 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddShape = (shape: ShapeType) => {
    const newShape: MeshObject = {
      id: THREE.MathUtils.generateUUID(), name: `${shape} ${Date.now() % 1000}`, type: SceneObjectType.Mesh, shape, color: '#cccccc',
      transform: { position: { x: Math.random() * 4 - 2, y: 1 + Math.random() * 2, z: Math.random() * 4 - 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    };
    onAddItem(newShape);
  };

  const handleAddLight = (type: SceneObjectType.PointLight | SceneObjectType.DirectionalLight) => {
    const commonLightProps = {
      id: THREE.MathUtils.generateUUID(), name: `${type === SceneObjectType.PointLight ? 'Point' : 'Directional'} Light ${Date.now() % 1000}`, color: '#ffffff',
      transform: { position: { x: Math.random() * 4 - 2, y: 3 + Math.random() * 2, z: Math.random() * 4 - 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    };
    if (type === SceneObjectType.PointLight) onAddItem({ ...commonLightProps, type: SceneObjectType.PointLight, intensity: 5 } as PointLightObject);
    else onAddItem({ ...commonLightProps, type: SceneObjectType.DirectionalLight, intensity: 2 } as DirectionalLightObject);
  };
  
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) { onImportGLB(file); if(fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const isSelected = (id: string) => selectedObjectIds.includes(id);

  const groupableSelectedItemsCount = useMemo(() => {
    return selectedObjectIds
        .map(id => appState.sceneObjects.find(obj => obj.id === id))
        .filter(item => 
            item && 
            item.type !== SceneObjectType.Group && 
            (item.type === SceneObjectType.Mesh || 
              item.type === SceneObjectType.PointLight || 
              item.type === SceneObjectType.DirectionalLight || 
              item.type === SceneObjectType.ImportedGLB)
        ).length;
  }, [selectedObjectIds, appState.sceneObjects]);

  const handleAddTerrain = () => {
    const newTerrain: TerrainConfig = {
      id: THREE.MathUtils.generateUUID(),
      name: `Terrain ${Date.now() % 1000}`,
      type: SceneObjectType.Terrain,
      width: 10,
      height: 10,
      widthSegments: 32,
      heightSegments: 32,
      color: '#8B4513',        // Manter para compatibilidade
      color1: '#8B4513',       // Marrom
      color2: '#228B22',       // Verde
      mixFactor: 0.5,
      mixPattern: 'gradient'
    };
    onAddTerrain();
  };

  return (
    <div className="w-72 bg-gray-800 p-4 space-y-3 border-r border-gray-700 h-full overflow-y-auto shadow-lg">
      <h2 className="text-2xl font-semibold text-white mb-6 text-center border-b border-gray-700 pb-3">Construtor 3D</h2>

      <AccordionItem title="Cena Global" icon={<SkyIcon className="w-6 h-6 text-blue-300" />}>
        <Button onClick={() => onToggleSelection('sky_config', false)} variant={isSelected('sky_config') ? 'primary' : 'secondary'} className="w-full">Configurar Céu</Button>
        
        {appState.terrain ? (
          <Button onClick={() => onToggleSelection('terrain_config', false)} variant={isSelected('terrain_config') ? 'primary' : 'secondary'} className="w-full flex items-center justify-center">
            <TerrainIcon className="mr-2 w-5 h-5 opacity-80" /> Configurar Terreno
          </Button>
        ) : (
          <Button onClick={onAddTerrain} variant={'secondary'} className="w-full flex items-center justify-center">
            <TerrainIcon className="mr-2 w-5 h-5 opacity-80" /> Adicionar Terreno
          </Button>
        )}

        <Button onClick={() => onToggleSelection('ambient_light_config', false)} variant={isSelected('ambient_light_config') ? 'primary' : 'secondary'} className="w-full">Luz Ambiente</Button>
        <Button onClick={() => onToggleSelection('camera_config', false)} variant={isSelected('camera_config') ? 'primary' : 'secondary'} className="w-full">Câmera Principal</Button>
      </AccordionItem>

      <AccordionItem title="Adicionar Elementos" icon={<CubeIcon className="w-6 h-6 text-green-300" />}>
        <Button onClick={() => handleAddShape(ShapeType.Cube)} className="w-full">Adicionar Cubo</Button>
        <Button onClick={() => handleAddShape(ShapeType.Sphere)} className="w-full">Adicionar Esfera</Button>
        <Button onClick={() => handleAddShape(ShapeType.Cylinder)} className="w-full">Adicionar Cilindro</Button>
        <Button onClick={() => handleAddShape(ShapeType.Cone)} className="w-full">Adicionar Cone</Button>
        <Button onClick={() => handleAddShape(ShapeType.Plane)} className="w-full">Adicionar Plano</Button>
        <Button onClick={() => handleAddLight(SceneObjectType.PointLight)} className="w-full mt-2 border-t border-gray-600 pt-2">Luz Pontual</Button>
        <Button onClick={() => handleAddLight(SceneObjectType.DirectionalLight)} className="w-full">Luz Direcional</Button>
      </AccordionItem>
      
      {groupableSelectedItemsCount > 0 && (
        <div className="pt-3 border-t border-gray-700">
          <h3 className="text-lg font-medium text-gray-300 mb-2">Agrupamento</h3>
          <Button 
            onClick={onCreateGroupFromSelection} 
            disabled={groupableSelectedItemsCount < 1}
            className="w-full flex items-center justify-center"
            title={groupableSelectedItemsCount > 0 ? "Agrupar objetos selecionados" : "Selecione um ou mais objetos (não grupos) para agrupar"}
          >
            <GroupIcon className="mr-2 w-5 h-5" /> Agrupar Selecionados ({groupableSelectedItemsCount})
          </Button>
        </div>
      )}

      <div className="pt-3 border-t border-gray-700">
        <h3 className="text-lg font-medium text-gray-300 mb-2">Importar / Exportar</h3>
        <input type="file" accept=".glb" ref={fileInputRef} onChange={handleFileImport} className="hidden" />
        <Button onClick={() => fileInputRef.current?.click()} className="mb-2" size="sm">
          <UploadIcon className="mr-2" /> Importar .glb
        </Button>
        <Button onClick={onExportGLB} size="sm">
          <DownloadIcon className="mr-2" /> Exportar .glb
        </Button>
      </div>
    </div>
  );
};

export default LeftSidebar;
