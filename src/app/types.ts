export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  shape: string;
  severity: string;
}

export interface BoxPrediction {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  shape: string;
  severity: string;
  prediction: {
    type: string;
    shape: string;
    severity: string;
  } | null;
}

export interface StoredImage {
  original: string;
  withBoxes?: string;
  boxes?: BoundingBox[];
  faceDetected?: boolean;
  faceData?: any[];
  timestamp: string;
  filename: string;
  prediction?: { type: string; shape: string; severity: string };
  predictions?: BoxPrediction[];
  hasPrediction?: boolean;
  statusMessage?: string;
  detectionMessage?: string;
}

export interface ImageSession {
  id: string;
  name: string;
  imageKeys: string[];
  created: string;
  totalBoundingBoxes?: number;
}