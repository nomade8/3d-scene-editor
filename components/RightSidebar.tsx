import React from 'react';
import { 
  SelectableItem, SceneObjectType, MeshObject, PointLightObject, DirectionalLightObject, 
  SkyConfig, TerrainConfig, CameraConfig, AmbientLightObject, GroupObject, SceneObject,
  Vector3, AppState, ImportedGLBObject, HeightGenerationMethod
} from '../types';
import Slider from './Slider';
import ColorPicker from './ColorPicker';
import Button from './Button';
import { TrashIcon, DuplicateIcon, GroupIcon } from './icons';

interface RightSidebarProps {
  selectedItem: SelectableItem | null; 
  appState: AppState; 
  onUpdateItem: (item: SelectableItem) => void;
  onDeleteItem?: (id: string) => void;
  onDuplicateItem?: (id: string) => void; 
  onSetParentGroup?: (childId: string, parentGroupId: string | null) => void;
  onDisbandGroup?: (groupId: string) => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ 
  selectedItem, appState, onUpdateItem, onDeleteItem, onDuplicateItem, 
  onSetParentGroup, onDisbandGroup 
}) => {
  if (!selectedItem) {
    return (
      <div className="w-80 bg-gray-800 bg-opacity-90 p-4 border-l border-gray-700 h-full overflow-y-auto absolute top-0 right-0 shadow-xl">
        <p className="text-gray-400 text-center mt-10">
          {appState.selectedObjectIds.length > 1 
            ? `${appState.selectedObjectIds.length} itens selecionados. Edite propriedades individuais ou agrupe-os.`
            : "Selecione um item para editar suas propriedades."
          }
        </p>
      </div>
    );
  }

  const isTerrainSelectedAndExists = selectedItem.type === SceneObjectType.Terrain && appState.terrain !== null;
  // Cast selectedItem to TerrainConfig if it's the selected terrain that exists
  const currentTerrainConfig = isTerrainSelectedAndExists ? appState.terrain as TerrainConfig : null;


  const handleTransformChange = (axis: 'x' | 'y' | 'z', type: 'position' | 'rotation' | 'scale', value: number) => {
    if ('transform' in selectedItem && (selectedItem as SceneObject).transform) {
      const updatedItem = JSON.parse(JSON.stringify(selectedItem)); 
      updatedItem.transform[type][axis] = value;
      onUpdateItem(updatedItem);
    }
  };

  const handleColorChange = (newColor: string) => {
    if ('color' in selectedItem) {
      onUpdateItem({ ...selectedItem, color: newColor });
    }
  };

  const handleIntensityChange = (newIntensity: number) => {
      if ('intensity' in selectedItem) {
      onUpdateItem({ ...selectedItem, intensity: newIntensity });
    }
  };
  
  const handleFovChange = (newFov: number) => {
    if (selectedItem.type === SceneObjectType.Camera) {
      onUpdateItem({ ...selectedItem, fov: newFov } as CameraConfig);
    }
  };

  const handleCameraPositionChange = (axis: 'x' | 'y' | 'z', value: number) => {
    if (selectedItem.type === SceneObjectType.Camera) {
      const newPosition = { ... (selectedItem as CameraConfig).position };
      newPosition[axis] = value;
      onUpdateItem({ ...selectedItem, position: newPosition } as CameraConfig);
    }
  };

  // Terrain specific updates
  const handleTerrainPropertyChange = (property: keyof TerrainConfig, value: any) => {
    if (currentTerrainConfig) {
      onUpdateItem({ ...currentTerrainConfig, [property]: value });
    }
  };

  const handleColor1Change = (newColor: string) => {
    if (selectedItem.type === SceneObjectType.Terrain) {
      onUpdateItem({ ...selectedItem, color1: newColor } as TerrainConfig);
    }
  };

  const handleColor2Change = (newColor: string) => {
    if (selectedItem.type === SceneObjectType.Terrain) {
      onUpdateItem({ ...selectedItem, color2: newColor } as TerrainConfig);
    }
  };

  const handleMixFactorChange = (newMixFactor: number) => {
    if (selectedItem.type === SceneObjectType.Terrain) {
      onUpdateItem({ ...selectedItem, mixFactor: newMixFactor } as TerrainConfig);
    }
  };

  const handleMixPatternChange = (newPattern: 'gradient' | 'noise' | 'checkerboard') => {
    if (selectedItem.type === SceneObjectType.Terrain) {
      onUpdateItem({ ...selectedItem, mixPattern: newPattern } as TerrainConfig);
    }
  };

  const handleGroupSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (onSetParentGroup && selectedItemIsManagableSceneObject(selectedItem) && 'id' in selectedItem) {
      const parentGroupId = e.target.value === "none" ? null : e.target.value;
      onSetParentGroup(selectedItem.id, parentGroupId);
    }
  };

  const renderTransformControls = (transform: { position: Vector3; rotation: Vector3; scale: Vector3; }) => (
    <>
      <h4 className="text-md font-semibold mt-3 mb-1 text-gray-200">Posição</h4>
      <Slider label="X" value={transform.position.x} min={-20} max={20} step={0.1} onChange={(v) => handleTransformChange('x', 'position', v)} />
      <Slider label="Y" value={transform.position.y} min={-20} max={20} step={0.1} onChange={(v) => handleTransformChange('y', 'position', v)} />
      <Slider label="Z" value={transform.position.z} min={-20} max={20} step={0.1} onChange={(v) => handleTransformChange('z', 'position', v)} />
      <h4 className="text-md font-semibold mt-3 mb-1 text-gray-200">Rotação (Graus)</h4>
      <Slider label="X" value={transform.rotation.x} min={-360} max={360} step={1} onChange={(v) => handleTransformChange('x', 'rotation', v)} />
      <Slider label="Y" value={transform.rotation.y} min={-360} max={360} step={1} onChange={(v) => handleTransformChange('y', 'rotation', v)} />
      <Slider label="Z" value={transform.rotation.z} min={-360} max={360} step={1} onChange={(v) => handleTransformChange('z', 'rotation', v)} />
      <h4 className="text-md font-semibold mt-3 mb-1 text-gray-200">Escala</h4>
      <Slider label="X" value={transform.scale.x} min={0.01} max={20} step={0.01} onChange={(v) => handleTransformChange('x', 'scale', v)} />
      <Slider label="Y" value={transform.scale.y} min={0.01} max={20} step={0.01} onChange={(v) => handleTransformChange('y', 'scale', v)} />
      <Slider label="Z" value={transform.scale.z} min={0.01} max={20} step={0.01} onChange={(v) => handleTransformChange('z', 'scale', v)} />
    </>
  );

  const displayName = ('name' in selectedItem && typeof selectedItem.name === 'string' && selectedItem.name) 
    ? selectedItem.name 
    : (selectedItem.type === SceneObjectType.Terrain && appState.terrain ? "Terreno" : selectedItem.type); 
  
  const selectedItemIsManagableSceneObject = (item: SelectableItem): item is SceneObject => {
    return item.type === SceneObjectType.Mesh || 
            item.type === SceneObjectType.PointLight || 
            item.type === SceneObjectType.DirectionalLight || 
            item.type === SceneObjectType.Group ||
            item.type === SceneObjectType.ImportedGLB;
  }

  const canBeGroupChild = (item: SelectableItem): item is MeshObject | PointLightObject | DirectionalLightObject | ImportedGLBObject => {
      return item.type === SceneObjectType.Mesh || 
            item.type === SceneObjectType.PointLight || 
            item.type === SceneObjectType.DirectionalLight ||
            item.type === SceneObjectType.ImportedGLB;
  }

  const isSelectedTypeDuplicable = 
      selectedItem.type === SceneObjectType.Mesh ||
      selectedItem.type === SceneObjectType.PointLight ||
      selectedItem.type === SceneObjectType.DirectionalLight;

  const availableGroups = appState.sceneObjects.filter(obj => obj.type === SceneObjectType.Group) as GroupObject[];
  const numSelectedTotal = appState.selectedObjectIds.length;

  return (
    <div className="w-80 bg-gray-800 bg-opacity-95 p-4 border-l border-gray-700 h-full overflow-y-auto absolute top-0 right-0 shadow-xl z-10">
      <div className="flex justify-between items-center mb-1">
        <h3 className="text-lg font-semibold text-white capitalize truncate pr-2" title={displayName.replace(/_/g, ' ')}>{displayName.replace(/_/g, ' ')}</h3>
        <div className="flex space-x-2">
          {onDuplicateItem && selectedItemIsManagableSceneObject(selectedItem) && isSelectedTypeDuplicable && numSelectedTotal === 1 && (
              <Button onClick={() => onDuplicateItem(selectedItem.id)} variant="secondary" size="sm" className="p-1.5" title="Duplicar Objeto">
                <DuplicateIcon className="w-4 h-4" />
            </Button>
          )}
          {onDeleteItem && selectedItemIsManagableSceneObject(selectedItem) && numSelectedTotal === 1 && (
            <Button onClick={() => onDeleteItem(selectedItem.id)} variant="danger" size="sm" className="p-1.5" title="Excluir Objeto">
              <TrashIcon className="w-4 h-4" />
            </Button>
          )}
          {onDeleteItem && isTerrainSelectedAndExists && numSelectedTotal === 1 && ( 
              <Button 
                onClick={() => onDeleteItem(selectedItem.id)} 
                variant="danger" 
                size="sm" 
                className="p-1.5" 
                title="Excluir Terreno" 
              >
                <TrashIcon className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      {numSelectedTotal > 1 && (
        <p className="text-xs text-gray-400 mb-3 italic">({numSelectedTotal} itens selecionados. Editando: {displayName.replace(/_/g, ' ')})</p>
      )}

      {/* Generic Color Picker */}
      {'color' in selectedItem && selectedItem.type !== SceneObjectType.Terrain && (
        <ColorPicker label="Cor" color={(selectedItem as any).color} onChange={handleColorChange} />
      )}
      {/* Terrain Color Picker - only if terrain is selected and exists */}
      {currentTerrainConfig && (
        <ColorPicker label="Cor do Terreno" color={currentTerrainConfig.color} onChange={(v) => handleTerrainPropertyChange('color', v)} />
      )}

      {'intensity' in selectedItem && (
        <Slider label="Intensidade" value={(selectedItem as any).intensity} min={0} max={10} step={0.1} onChange={handleIntensityChange} />
      )}

      {selectedItemIsManagableSceneObject(selectedItem) && 'transform' in selectedItem && renderTransformControls(selectedItem.transform)}

      {selectedItemIsManagableSceneObject(selectedItem) && 
        selectedItem.type !== SceneObjectType.Group && 
        canBeGroupChild(selectedItem) && 
        onSetParentGroup && numSelectedTotal === 1 && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <label htmlFor="group-select" className="block text-sm font-medium text-gray-300 mb-1">
            Grupo Pai:
          </label>
          {(selectedItem as SceneObject).parentId && (
            <div className="mb-2 text-sm text-gray-400">
              Faz parte de: {appState.sceneObjects.find(g => g.id === (selectedItem as SceneObject).parentId)?.name || 'Grupo Desconhecido'}
            </div>
          )}
          <select
            id="group-select"
            value={(selectedItem as SceneObject).parentId || "none"}
            onChange={handleGroupSelectionChange}
            className="w-full p-2 bg-gray-700 text-white rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
          >
            <option value="none">Nenhum (nível raiz)</option>
            {availableGroups.filter(g => g.id !== selectedItem.id).map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>
      )}

      {selectedItem.type === SceneObjectType.Group && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <h4 className="text-md font-semibold text-gray-200 mb-1">Objetos Filhos ({ (selectedItem as GroupObject).childIds.length }):</h4>
          {(selectedItem as GroupObject).childIds.length > 0 ? (
            <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 max-h-32 overflow-y-auto">
              {(selectedItem as GroupObject).childIds.map(childId => {
                const childObj = appState.sceneObjects.find(obj => obj.id === childId);
                return <li key={childId}>{childObj?.name || childId}</li>;
              })}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 italic">Este grupo está vazio.</p>
          )}
          {onDisbandGroup && numSelectedTotal === 1 && ( 
              <Button onClick={() => onDisbandGroup(selectedItem.id)} variant="secondary" size="sm" className="w-full mt-3">
                <GroupIcon className="mr-2 opacity-70 w-4 h-4" /> Desmembrar Grupo
            </Button>
          )}
        </div>
      )}

      {selectedItem.type === SceneObjectType.Sky && ( <></> )}
      
      {/* Terrain specific controls */}
      {currentTerrainConfig && (
        <>
          <div className="mt-4 pt-3 border-t border-gray-700">
            <h4 className="text-md font-semibold text-gray-200 mb-2">Propriedades do Terreno</h4>
            <Slider label="Tamanho" value={currentTerrainConfig.size} min={10} max={200} step={1} onChange={(v) => handleTerrainPropertyChange('size', v)} />
            <Slider label="Detalhe (Segmentos)" value={currentTerrainConfig.segments} min={4} max={128} step={1} onChange={(v) => handleTerrainPropertyChange('segments', v)} />
          </div>

          <div className="mt-4 pt-3 border-t border-gray-700">
            <h4 className="text-md font-semibold text-gray-200 mb-2">Modificação de Altura do Terreno</h4>
            <label htmlFor="height-gen-method" className="block text-sm font-medium text-gray-300 mb-1">Método de Geração:</label>
            <select
              id="height-gen-method"
              value={currentTerrainConfig.heightGenerationMethod}
              onChange={(e) => handleTerrainPropertyChange('heightGenerationMethod', e.target.value as HeightGenerationMethod)}
              className="w-full p-2 bg-gray-700 text-white rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm mb-3"
            >
              {Object.values(HeightGenerationMethod).map(method => (
                <option key={method} value={method}>
                  {method === HeightGenerationMethod.Flat && "Plano"}
                  {method === HeightGenerationMethod.SimplexNoise && "Ruído Simplex"}
                  {method === HeightGenerationMethod.SineWave && "Onda Senoidal"}
                </option>
              ))}
            </select>

            {currentTerrainConfig.heightGenerationMethod === HeightGenerationMethod.SimplexNoise && (
              <>
                <Slider label="Escala do Ruído" value={currentTerrainConfig.noiseScale} min={0.01} max={0.5} step={0.005} onChange={(v) => handleTerrainPropertyChange('noiseScale',v)} />
                <Slider label="Amplitude do Ruído" value={currentTerrainConfig.noiseAmplitude} min={0} max={20} step={0.1} onChange={(v) => handleTerrainPropertyChange('noiseAmplitude',v)} />
              </>
            )}

            {currentTerrainConfig.heightGenerationMethod === HeightGenerationMethod.SineWave && (
              <>
                <Slider label="Frequência X da Onda" value={currentTerrainConfig.sineFrequencyX} min={0.01} max={5} step={0.01} onChange={(v) => handleTerrainPropertyChange('sineFrequencyX',v)} />
                <Slider label="Frequência Z da Onda" value={currentTerrainConfig.sineFrequencyZ} min={0.01} max={5} step={0.01} onChange={(v) => handleTerrainPropertyChange('sineFrequencyZ',v)} />
                <Slider label="Amplitude da Onda" value={currentTerrainConfig.sineAmplitude} min={0} max={10} step={0.1} onChange={(v) => handleTerrainPropertyChange('sineAmplitude',v)} />
              </>
            )}
            {/* If Flat, no additional controls needed, amplitude set to 0 by default or handled in ThreeCanvas */}
              {(currentTerrainConfig.heightGenerationMethod === HeightGenerationMethod.SimplexNoise || currentTerrainConfig.heightGenerationMethod === HeightGenerationMethod.SineWave) &&
                currentTerrainConfig.noiseAmplitude === 0 && currentTerrainConfig.sineAmplitude === 0 && (
                <p className="text-xs text-yellow-400 mt-1 italic">Dica: Aumente a amplitude para ver o efeito.</p>
            )}
          </div>
        </>
      )}


      {selectedItem.type === SceneObjectType.Camera && (
          <>
          <h4 className="text-md font-semibold mt-3 mb-1 text-gray-200">Posição da Câmera</h4>
          <Slider label="X" value={(selectedItem as CameraConfig).position.x} min={-50} max={50} step={0.1} onChange={(v) => handleCameraPositionChange('x', v)} />
          <Slider label="Y" value={(selectedItem as CameraConfig).position.y} min={-50} max={50} step={0.1} onChange={(v) => handleCameraPositionChange('y', v)} />
          <Slider label="Z" value={(selectedItem as CameraConfig).position.z} min={-50} max={50} step={0.1} onChange={(v) => handleCameraPositionChange('z', v)} />
          <Slider label="Campo de Visão (FOV)" value={(selectedItem as CameraConfig).fov} min={10} max={120} step={1} onChange={handleFovChange} />
        </>
      )}
    </div>
  );
};

export default RightSidebar;
