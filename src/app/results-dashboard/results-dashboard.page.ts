import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController, Platform } from '@ionic/angular';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';

interface ChartSlice {
  label: string;
  value: number;
  color: string;
}

interface AggregateStats {
  type: { [key: string]: number };
  severity: { [key: string]: number };
  shape: { [key: string]: number };
  totalCracks: number;
  totalImages: number;
}

type PredictionLike = {
  type?: string;
  shape?: string;
  severity?: string;
  boxes?: any[];
} | null | undefined;

@Component({
  selector: 'app-results-dashboard',
  templateUrl: './results-dashboard.page.html',
  styleUrls: ['./results-dashboard.page.scss'],
  standalone: false,
})
export class ResultsDashboardPage implements OnInit {
  sessionId: string | null = null;
  stats: AggregateStats = {
    type: {},
    severity: {},
    shape: {},
    totalCracks: 0,
    totalImages: 0,
  };

  // UI state
  showBar = true; // toggle between BAR and PIE sections
  selectedGraphType: 'type' | 'shape' | 'severity' | 'all' = 'type'; // track which data to display
  selectedChartType: 'bar' | 'pie' = 'bar'; // bar or pie chart
  showGraphOverlay = false; // overlay visibility
  // Session image selection
  availableSessionImages: StoredImage[] = [];
  selectedImageKeys: string[] = [];
  Math = Math;
  private backButtonSub: any; // hardware back handler

  // Placeholder data for sample graphs
  placeholderData = {
    type: { 'Linear': 12, 'Alligator': 8, 'Block': 6 },
    severity: { 'Low': 5, 'Medium': 15, 'High': 6 },
    shape: { 'Straight': 10, 'Curved': 12, 'Network': 4 }
  };

  constructor(
    private storage: ImageStorageService,
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private router: Router,
    private platform: Platform
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(async (params) => {
      this.sessionId = params['sessionId'] || null;
      await this.loadData();
      try {
        this.printSessionObjects();
      } catch (e) {
        console.warn('printSessionObjects failed:', e);
      }
    });

    /**
     * Lifecycle hook invoked after component construction.
     * - Reads `sessionId` from query params.
     * - Loads session/image data via `loadData()`.
     * - Attempts a debug dump via `printSessionObjects()`.
     * Interaction: entry point for initializing UI state and statistics.
     */

     
  }

  private async loadData(): Promise<void> {
    // Check sessionStorage for session data from feedback-page
    this.retrieveAndLogSessionFromStorage();
    
    //Read every stored image and set a working imgs list (defaults to all).
    const all = this.storage.getAllImages();
    let imgs: StoredImage[] = all;
    //If a sessionId was passed, load the stored session object to the session images.
    if (this.sessionId) {
      const s = this.storage.getSession(this.sessionId);
      if (s) {
        //Select only images that match any of the session's imageKeys  match by original or filename for compatibility
        // Match session image keys against multiple possible stored-image identifiers
        imgs = all.filter((i) =>
          s.imageKeys.includes(i.original) ||
          (i.withBoxes && s.imageKeys.includes(i.withBoxes)) ||
          (i.filename && s.imageKeys.includes(i.filename))
        );

        //Remove duplicate stored images in case of duplicates by a stable key
        //  (filename preferred, fallback to original / withBoxes) to avoid double-counting.
        const seen = new Set<string>();
        imgs = imgs.filter(i => {
          const key = i.filename || i.original || (i.withBoxes as string) || '';
          if (!key) return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        // Hydrate image payloads so withBoxes survives navigation to PDF.
        imgs = await this.hydrateSessionImages(imgs);

        //Save the sessions available images and select all of them by default 
        // (selected keys used for later aggregation).
        this.availableSessionImages = imgs;
        this.selectedImageKeys = imgs.map((i) => this.getImageKey(i));

       
        // aggregate based on selected images initially all
        this.aggregateSelectedImages();

        //Purpose: If the session object contains a totalBoundingBoxes number, 
        // use it for stats.totalCracks (keeps backward compatibility)
        if (typeof (s as any).totalBoundingBoxes === 'number') {
          // prefer stored session totalBoundingBoxes if available for totalCracks
          this.stats.totalCracks = (s as any).totalBoundingBoxes || 0;
        }

        // Record how many images were actually found for the session and sets the totalImages 
        // to the number of iamges present in the session 
        // return early (session branch complete).
        this.stats.totalImages = imgs.length;
        return;
      }

      console.warn('[ResultsDashboard.loadData] Session not found for sessionId:', this.sessionId);
      this.availableSessionImages = [];
      this.selectedImageKeys = [];
      this.stats = { type: {}, severity: {}, shape: {}, totalCracks: 0, totalImages: 0 };
      return;
    }

    // No session specified or session not found -> aggregate across all images
    //If there is no session context, compute aggregate stats across every stored image.
    this.aggregate(imgs, all.length);
  }

  /**
   * Retrieve and log session data from sessionStorage for debugging.
   * Images are retrieved in descending order as stored.
   */
  private retrieveAndLogSessionFromStorage(): void {
    try {
      const sessionData = sessionStorage.getItem('feedbackPageSession');
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        console.group('[ResultsDashboard] 📋 Retrieved session from sessionStorage (descending order)');
        console.log('Session ID:', parsed.selectedSessionId);
        console.log('Image count:', parsed.imageCount);
        console.log('Timestamp:', parsed.timestamp);
        if (parsed.imagePaths && Array.isArray(parsed.imagePaths)) {
          console.log('Image order:', parsed.imagePaths.map((img: any, i: number) => `${i}: ${img.filename || 'unnamed'}`).join(', '));
        }
        console.log('Full session data:', parsed);
        console.groupEnd();
      } else {
        console.log('[ResultsDashboard] No session data found in sessionStorage');
      }
    } catch (err) {
      console.warn('[ResultsDashboard] Failed to retrieve session from sessionStorage', err);
    }
  }

  private async hydrateSessionImages(images: StoredImage[]): Promise<StoredImage[]> {
    const hydrated: StoredImage[] = [];

    for (const img of images || []) {
      try {
        const copy: any = { ...img };

        // Hydrate original if missing
        if ((!copy.original || copy.original.trim().length === 0) && (copy.originalS3Key || copy.storagePath || copy.originalS3Url || copy.storageUrl)) {
          const originalKey = copy.originalS3Key || copy.storagePath || copy.originalS3Url || copy.storageUrl;
          try {
            const fetchedOriginal = await this.storage.fetchS3ObjectAsDataUrl(originalKey);
            if (fetchedOriginal) copy.original = fetchedOriginal;
          } catch (e) {
            console.warn('[ResultsDashboard] Failed to hydrate original image', copy.filename, e);
          }
        }

        // Hydrate withBoxes from S3 if available
        if ((!copy.withBoxes || (typeof copy.withBoxes === 'string' && copy.withBoxes.trim().length === 0)) && (copy.withBoxesS3Key || copy.withBoxesStoragePath || copy.withBoxesS3Url || copy.withBoxesStorageUrl)) {
          const withBoxesKey = copy.withBoxesS3Key || copy.withBoxesStoragePath || copy.withBoxesS3Url || copy.withBoxesStorageUrl;
          try {
            const fetchedWithBoxes = await this.storage.fetchS3ObjectAsDataUrl(withBoxesKey);
            if (fetchedWithBoxes) copy.withBoxes = fetchedWithBoxes;
          } catch (e) {
            console.warn('[ResultsDashboard] Failed to hydrate withBoxes image', copy.filename, e);
          }
        }

        // If withBoxes still missing but we have boxes and an original image, generate it locally
        if ((!copy.withBoxes || (typeof copy.withBoxes === 'string' && copy.withBoxes.trim() === '')) && copy.boxes && copy.boxes.length > 0 && copy.original) {
          try {
            const generated = await this.createWithBoxesDataUrl(copy.original, copy.boxes);
            if (generated) {
              copy.withBoxes = generated;
              try {
                const key = copy.filename || this.getImageKey(copy) || '';
                if (key) {
                  const existingEntry = this.storage.getEntryForImage(key) as any || {};
                  await this.storage.setEntryForImage(key, {
                    ...existingEntry,
                    withBoxes: generated
                  });
                }
              } catch (e) {
                console.warn('[ResultsDashboard] Failed to persist generated withBoxes for', this.getImageKey(copy), e);
              }
            }
          } catch (e) {
            console.warn('[ResultsDashboard] Failed to generate withBoxes', copy.filename, e);
          }
        }

        hydrated.push(copy as StoredImage);
      } catch (err) {
        console.warn('[ResultsDashboard] hydrateSessionImages: skipping image due to error', err);
      }
    }

    return hydrated;
  }

  // Create an annotated copy of an original data URL by drawing boxes on a canvas.
  private async createWithBoxesDataUrl(originalDataUrl: string, boxes: any[]): Promise<string> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(originalDataUrl);
            ctx.drawImage(img, 0, 0);
            ctx.lineWidth = Math.max(2, Math.round(Math.min(img.width, img.height) * 0.01));
            ctx.strokeStyle = 'rgba(255,0,0,0.9)';
            ctx.fillStyle = 'rgba(255,0,0,0.12)';
            (boxes || []).forEach((b: any) => {
              let x = b.x ?? b.left ?? 0;
              let y = b.y ?? b.top ?? 0;
              let w = b.w ?? b.width ?? b.wid ?? 0;
              let h = b.h ?? b.height ?? b.hei ?? 0;
              // If normalized coords (<=1) convert to pixels
              if (x <= 1 && y <= 1 && w <= 1 && h <= 1) {
                x = x * img.width;
                y = y * img.height;
                w = w * img.width;
                h = h * img.height;
              }
              ctx.strokeRect(x, y, w, h);
              ctx.fillRect(x, y, w, h);
            });
            const dataUrl = canvas.toDataURL('image/png');
            resolve(dataUrl);
          } catch (e) {
            console.warn('[ResultsDashboard] canvas draw failed', e);
            resolve(originalDataUrl);
          }
        };
        img.onerror = () => resolve(originalDataUrl);
        img.src = originalDataUrl;
      } catch (e) {
        console.warn('[ResultsDashboard] createWithBoxesDataUrl top-level error', e);
        resolve(originalDataUrl);
      }
    });
  }

  /**
   * Print the current session objects to the console for debugging.
   */
  private printSessionObjects(): void {
    try {
      console.log('--- Session Objects (ResultsDashboard) ---');
      //display sessionId, stored session object, available images, selected keys, stats
      console.log('sessionId:', this.sessionId);
      const storedSession = this.sessionId ? this.storage.getSession(this.sessionId) : null;
      console.log('storedSession:', storedSession);
      if (this.availableSessionImages && this.availableSessionImages.length > 0) {
        console.log(`availableSessionImages (${this.availableSessionImages.length}):`, this.availableSessionImages);
      } else {
        console.log('availableSessionImages: none');
      }
      console.log('selectedImageKeys:', this.selectedImageKeys);
      console.log('stats:', this.stats);
      console.log('------------------------------------------');
    } catch (err) {
      console.warn('Error while printing session objects:', err);
    }
  }

  /**
   * Count session images whose status indicates prediction failure.
   * Considers `statusMessage` containing "Prediction failed" or "No prediction" (case-insensitive).
   */
  getFailedImagesProcessedCount(): number {
    try {
      if (!this.availableSessionImages || this.availableSessionImages.length === 0) return 0;
      const count = this.availableSessionImages.reduce((acc, img) => {
        const s = (img as any)?.statusMessage || '';
        const lower = (s || '').toString().toLowerCase();
        if (lower.includes('prediction failed') || lower.includes('no prediction')) return acc + 1;
        return acc;
      }, 0);
      return count;
    } catch (err) {
      console.warn('[ResultsDashboard] getFailedImagesProcessedCount failed', err);
      return 0;
    }
  }

  // Return a stable key for an image (filename as the only primary key)
  getImageKey(img: StoredImage): string {
    // Use the most stable available key so session filtering matches stored image references.
    return img.filename || img.original || img.withBoxes || img.storagePath || img.originalS3Key || img.withBoxesS3Key || '';
  }


   // Return a stable key for an image used in selection and lookup.
   // Uses `filename` only.
   // Interaction: used by selection helpers and to deduplicate images.

  isSelectedImage(img: StoredImage): boolean {
    return this.selectedImageKeys.includes(this.getImageKey(img));
  }
  
  //allows user to toggle which images to use
  //all boxes are checked, if unchecked get the stable key / 
  //filename, finds its index in the array then aggregate the data from the remaining img's
  toggleImageSelection(img: StoredImage): void {
    //Compute stable key for the image
    const key = this.getImageKey(img);

    //Find current selection index
    const idx = this.selectedImageKeys.indexOf(key);

    //Toggle selection (remove if present, add if absent)
    if (idx > -1) this.selectedImageKeys.splice(idx, 1);
    else this.selectedImageKeys.push(key);
    // re-aggregate using the updated selection
    this.aggregateSelectedImages();
  }


  //Toggle selection state for an image and re-aggregate stats.
  // Interaction: updates `selectedImageKeys` then calls `aggregateSelectedImages()`
  // to refresh `stats` displayed in the UI.


  // Aggregate only images currently selected for the session
  private aggregateSelectedImages(): void {
    //return early if no session images available
    if (!this.availableSessionImages || this.availableSessionImages.length === 0) return;

    //// Keep only images whose key is in selectedImageKeys
    const selected = this.availableSessionImages.filter((i) => this.selectedImageKeys.includes(this.getImageKey(i)));
    
    //Compute number of selected images
    const totalImages = selected.length;

    //Aggregate stats for the selected images
    this.aggregate(selected, totalImages);
  }

  private aggregate(images: StoredImage[], totalImages: number): void {

    //Setup counters / records
    const type: Record<string, number> = {};
    const severity: Record<string, number> = {};
    const shape: Record<string, number> = {};
    let totalCracks = 0;
     
    //Iterate images loop start, use rawPrediction array if present: 
    //each entry counts as one detection
    //iterate through each img raw prediction and increment / update the type, 
    //severity, shape counts
    images.forEach((img) => {
      const corrected = (img as any).correctedPrediction as PredictionLike;
      if (corrected) {
        const boxCount = Array.isArray(corrected.boxes) && corrected.boxes.length > 0 ? corrected.boxes.length : 1;
        totalCracks += boxCount;
        if (corrected.type) type[corrected.type] = (type[corrected.type] || 0) + boxCount;
        if (corrected.severity) severity[corrected.severity] = (severity[corrected.severity] || 0) + boxCount;
        if (corrected.shape) shape[corrected.shape] = (shape[corrected.shape] || 0) + boxCount;
        return;
      }

      // Prefer `rawPrediction` array if present: each entry counts as one detection
      const raw = (img as any).rawPrediction;
      if (Array.isArray(raw) && raw.length > 0) {
        raw.forEach((rp: any) => {
          totalCracks += 1;
          if (rp.type) type[rp.type] = (type[rp.type] || 0) + 1;
          if (rp.severity) severity[rp.severity] = (severity[rp.severity] || 0) + 1;
          if (rp.shape) shape[rp.shape] = (shape[rp.shape] || 0) + 1;
        });
        return; // move to next image
      }

      //  maintain previous behaviour using single prediction + optional boxes
      //single-prediction + boxes handling
      const p = img.prediction;
      if (!p) return;
      const boxCount = Array.isArray((img as any).boxes) && (img as any).boxes.length > 0 ? (img as any).boxes.length : 1;
      totalCracks += boxCount;
      if (p.type) type[p.type] = (type[p.type] || 0) + boxCount;
      if (p.severity) severity[p.severity] = (severity[p.severity] || 0) + boxCount;
      if (p.shape) shape[p.shape] = (shape[p.shape] || 0) + boxCount;
    });

    //Finalize and save aggregated stats
    this.stats = { type, severity, shape, totalCracks, totalImages };
  }

  // Donut percent: cracks detected over total images
  get detectionPercent(): number {
    if (this.stats.totalImages === 0) return 0;
    return Math.round((this.stats.totalCracks / this.stats.totalImages) * 100);
  }

  /**
   * Computed percent used for donut-style indicators.
   * Interaction: reads `stats.totalCracks` and `stats.totalImages`.
   */
  
  getScopeText(): string {
    //Declares a getter method that returns a short label describing current scope.
    return this.sessionId ? 'This Session' : 'All Sessions';
  }

  toggle(mode: 'bar' | 'pie') {
    this.showBar = mode === 'bar';
  }

  // 
  getMax(obj: { [k: string]: number }): number {
    //Collect numeric values from the object
    const vs = Object.values(obj);
    //Return the maximum or a safe fallback

    return vs.length ? Math.max(...vs) : 1;
  }

  goBack() {
    this.navCtrl.back();
  }

  //Sets which data category the UI should display (type/shape/severity/all).
  selectGraphType(type: 'type' | 'shape' | 'severity' | 'all') {
    this.selectedGraphType = type;
    console.log(`[Graph Selection] Data Type selected: ${type}`);
  }
  
  //Sets which chart style (bar or pie) the UI should display.
  selectChartType(type: 'bar' | 'pie') {
    this.selectedChartType = type;
    console.log(`[Graph Selection] Chart Type selected: ${type}`);
  }

  //opens the graph selection overlay
  openGraphOverlay() {
    this.showGraphOverlay = true;
    console.log('[Graph Overlay] Overlay opened');
    // no-op: page-level back handler will close overlay when active
  }
  
  //closes the graph selection overlay
  closeGraphOverlay() {
    this.showGraphOverlay = false;
    console.log('[Graph Overlay] Overlay closed');
    // overlay closed; nothing else required — page-level handler will remain active
  }

  ionViewDidEnter() {
    this.registerBackButtonHandler();
  }

  ionViewWillLeave() {
    this.removeBackButtonHandler();
  }

  private registerBackButtonHandler() {
    try {
      this.removeBackButtonHandler();
      // High priority so overlay-close takes precedence over lower-priority nav handlers
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(100, () => {
        if (this.showGraphOverlay) {
          this.closeGraphOverlay();
        } else {
          try { this.navCtrl.back(); } catch (e) { console.warn('nav back failed', e); }
        }
      });
    } catch (e) {
      console.warn('[ResultsDashboard] registerBackButtonHandler failed', e);
    }
  }

  private removeBackButtonHandler() {
    try {
      if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') {
        try { this.backButtonSub.unsubscribe(); } catch (e) {}
      } else if (this.backButtonSub && typeof this.backButtonSub.remove === 'function') {
        try { this.backButtonSub.remove(); } catch (e) {}
      }
    } catch (e) {}
    this.backButtonSub = null;
  }
   
  //Log selection — debug output
  applyGraphSelection() {
    console.log(`[Graph Selection] Applied - Chart: ${this.selectedChartType}, Data: ${this.selectedGraphType}`);
    this.closeGraphOverlay();
  }

  getSelectedData(): { [k: string]: number } {
    // If user wants to view all categories, merge them with readable prefixes
    if (this.selectedGraphType === 'all') {
      const out: { [k: string]: number } = {};
      const hasType = this.stats.type && Object.keys(this.stats.type).length > 0;
      const hasShape = this.stats.shape && Object.keys(this.stats.shape).length > 0;
      const hasSeverity = this.stats.severity && Object.keys(this.stats.severity).length > 0;

      if (hasType) {
        Object.entries(this.stats.type).forEach(([k, v]) => { out[`Type - ${k}`] = v; });
      }
      if (hasShape) {
        Object.entries(this.stats.shape).forEach(([k, v]) => { out[`Shape - ${k}`] = v; });
      }
      if (hasSeverity) {
        Object.entries(this.stats.severity).forEach(([k, v]) => { out[`Severity - ${k}`] = v; });
      }

      // If no stats available, fall back to placeholder combined view
      if (Object.keys(out).length === 0) {
        Object.entries(this.placeholderData.type).forEach(([k, v]) => { out[`Type - ${k}`] = v; });
        Object.entries(this.placeholderData.shape).forEach(([k, v]) => { out[`Shape - ${k}`] = v; });
        Object.entries(this.placeholderData.severity).forEach(([k, v]) => { out[`Severity - ${k}`] = v; });
      }
      return out;
    }
    
    //single-category selection — return stats or placeholders
    switch (this.selectedGraphType) {
      case 'type':
        return this.stats.type && Object.keys(this.stats.type).length > 0 ? this.stats.type : this.placeholderData.type;
      case 'shape':
        return this.stats.shape && Object.keys(this.stats.shape).length > 0 ? this.stats.shape : this.placeholderData.shape;
      case 'severity':
        return this.stats.severity && Object.keys(this.stats.severity).length > 0 ? this.stats.severity : this.placeholderData.severity;
      default:
        return this.stats.type && Object.keys(this.stats.type).length > 0 ? this.stats.type : this.placeholderData.type;
    }
  }


  //gets the graph title based on selected data type
  //Returns a short title string for the currently selected graph data type.
  getGraphTitle(): string {
    switch (this.selectedGraphType) {
      case 'type':
        return 'Type';
      case 'shape':
        return 'Shape';
      case 'severity':
        return 'Severity';
      case 'all':
        return 'All Categories';
      default:
        return 'Type';
    }
  }

  // Short descriptive subtitle for the graph explaining the chosen graph type and data type
  getGraphSubtitle(): string {
    const graphTypeText = this.selectedChartType === 'bar' ? 'Bar Chart' : 'Pie Chart';
    let dataTypeText = '';

    switch (this.selectedGraphType) {
      case 'type':
        dataTypeText = 'Type of Cracks (e.g., diagonal, horizontal, bar-like)';
        break;
      case 'severity':
        dataTypeText = 'Severity Levels (e.g., minor, medium, high)';
        break;
      case 'shape':
        dataTypeText = 'Shapes of Cracks (e.g., branching, straight, curved)';
        break;
      case 'all':
        dataTypeText = 'Combined Data: Type, Severity, and Shape';
        break;
      default:
        dataTypeText = 'Type of Cracks';
    }

    return `${graphTypeText} - ${dataTypeText}`;
  }

  // Colors used for pie slices
  private pieColors: string[] = ['#ff6b2d', '#ff9f43', '#ffbf7a', '#ffd9b8', '#ffeedd', '#ffd0a6'];

  // Computed pie data (key, value, percent, color) for template rendering
  get pieData(): Array<{ key: string; value: number; percent: number; color: string }> {
    const src = this.getSelectedData() || {};
    const entries = Object.entries(src);
    const total = entries.reduce((s, [, v]) => s + (typeof v === 'number' ? v : 0), 0) || 0;
    if (entries.length === 0) return [];
    let i = 0;
    return entries
      .map(([k, v]) => ({ key: k, value: v as number, percent: total ? Math.round(((v as number) / total) * 100) : 0, color: this.pieColors[i++ % this.pieColors.length] }))
      .sort((a, b) => b.value - a.value);
  }

  // Returns a CSS conic-gradient string representing the pie slices for the current selection
  getPieGradient(): string {
    const data = this.pieData;
    if (!data || data.length === 0) return 'linear-gradient(#eee,#eee)';
    let cum = 0;
    const parts: string[] = [];
    data.forEach((d) => {
      const start = cum;
      const end = cum + d.percent;
      parts.push(`${d.color} ${start}% ${end}%`);
      cum = end;
    });
    // If rounding left some remainder, fill remaining with muted color
    if (cum < 100) parts.push(`#eee ${cum}% 100%`);
    return `conic-gradient(${parts.join(', ')})`;
  }


  //used for export the current session to PDF
  //uses the sessionId to pass to the PDF page
  ExportPDF() {
    const queryParams: any = {};
    if (this.sessionId) queryParams.sessionId = this.sessionId;
    const selectedImages = this.availableSessionImages.filter((img) =>
      this.selectedImageKeys.includes(this.getImageKey(img))
    );

    this.router.navigate(['/pdf-page-test03'], {
      queryParams,
      state: {
        sessionId: this.sessionId,
        images: selectedImages.length > 0 ? selectedImages : this.availableSessionImages,
      },
    });
  }

  onBack() {
    this.goBack();
  }

  // Totals used by the overall-results-board
  get totalShapes(): number {
    return Object.values(this.stats.shape || {}).reduce((a, b) => a + b, 0);
  }

  get totalTypes(): number {
    return Object.values(this.stats.type || {}).reduce((a, b) => a + b, 0);
  }

  get totalSeverities(): number {
    return Object.values(this.stats.severity || {}).reduce((a, b) => a + b, 0);
  }

  // Helpers for template rendering of image cards
  getImageSrc(img: StoredImage): string {
    return (img as any).dataUrl || (img as any).storagePath || (img as any).withBoxes || (img as any).original || 'assets/placeholder.png';
  }

  getImageLabel(img: StoredImage): string {
    return img.filename || img.original || this.getImageKey(img) || `Image`;
  }

  getImageDate(img: StoredImage): string {
    return (img as any).date || (img as any).createdAt || (img as any).timestamp || 'Unknown Date';
  }

  getBoxCount(img: StoredImage): number {
    const corrected = (img as any).correctedPrediction as PredictionLike;
    if (corrected && Array.isArray(corrected.boxes)) {
      return corrected.boxes.length;
    }
    if (Array.isArray((img as any).boxes)) {
      return (img as any).boxes.length;
    }
    return (img as any).rawPrediction && Array.isArray((img as any).rawPrediction) ? (img as any).rawPrediction.length : 0;
  }

  getImagePredictionValue(img: StoredImage, key: 'type' | 'shape' | 'severity'): string {
    const corrected = (img as any).correctedPrediction as PredictionLike;
    if (corrected && corrected[key]) {
      return corrected[key] || 'Unknown';
    }
    const raw = (img as any).rawPrediction;
    if (Array.isArray(raw) && raw.length > 0) {
      const firstPrediction = raw[0];
      return firstPrediction[key] || 'Unknown';
    }
    return 'Unknown';
  }

  
}
