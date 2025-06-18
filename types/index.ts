export interface TerrainConfig {
  id: string;
  name: string;
  type: SceneObjectType.Terrain;
  width: number;
  height: number;
  widthSegments: number;
  heightSegments: number;
  color: string;          // Manter para compatibilidade
  color1: string;         // Nova: primeira cor
  color2: string;         // Nova: segunda cor
  mixFactor: number;      // Nova: intensidade da mistura (0-1)
  mixPattern: 'gradient' | 'noise' | 'checkerboard'; // Nova: padrão
}