import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
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
  selectedGraphType: 'type' | 'shape' | 'severity' = 'type'; // track which data to display
  selectedChartType: 'bar' | 'pie' = 'bar'; // bar or pie chart
  showGraphOverlay = false; // overlay visibility
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
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      this.sessionId = params['sessionId'] || null;
      this.loadData();
    });

     
  }

  private loadData(): void {
    const all = this.storage.getAllImages();
    let imgs: StoredImage[] = all;

    if (this.sessionId) {
      const s = this.storage.getSession(this.sessionId);
      if (s) {
        imgs = all.filter((i) => s.imageKeys.includes(i.filename));
      }
    }

    this.aggregate(imgs, all.length);
  }

  private aggregate(images: StoredImage[], totalImages: number): void {
    const type: Record<string, number> = {};
    const severity: Record<string, number> = {};
    const shape: Record<string, number> = {};
    let totalCracks = 0;

    images.forEach((img) => {
      const p = img.prediction;
      if (!p) return;
      totalCracks++;
      if (p.type) type[p.type] = (type[p.type] || 0) + 1;
      if (p.severity) severity[p.severity] = (severity[p.severity] || 0) + 1;
      if (p.shape) shape[p.shape] = (shape[p.shape] || 0) + 1;
    });

    this.stats = { type, severity, shape, totalCracks, totalImages };
  }

  // Donut percent: cracks detected over total images
  get detectionPercent(): number {
    if (this.stats.totalImages === 0) return 0;
    return Math.round((this.stats.totalCracks / this.stats.totalImages) * 100);
  }

  getScopeText(): string {
    return this.sessionId ? 'This Session' : 'All Sessions';
  }

  toggle(mode: 'bar' | 'pie') {
    this.showBar = mode === 'bar';
  }

  getMax(obj: { [k: string]: number }): number {
    const vs = Object.values(obj);
    return vs.length ? Math.max(...vs) : 1;
  }

  goBack() {
    this.navCtrl.back();
  }

  previewPDF() {
    const queryParams: any = {};
    if (this.sessionId) queryParams.sessionId = this.sessionId;
    this.router.navigate(['/pdf-preview-page'], { queryParams });
  }

  selectGraphType(type: 'type' | 'shape' | 'severity') {
    this.selectedGraphType = type;
    console.log(`[Graph Selection] Data Type selected: ${type}`);
  }

  selectChartType(type: 'bar' | 'pie') {
    this.selectedChartType = type;
    console.log(`[Graph Selection] Chart Type selected: ${type}`);
  }

  openGraphOverlay() {
    this.showGraphOverlay = true;
    console.log('[Graph Overlay] Overlay opened');
  }

  closeGraphOverlay() {
    this.showGraphOverlay = false;
    console.log('[Graph Overlay] Overlay closed');
  }

  applyGraphSelection() {
    console.log(`[Graph Selection] Applied - Chart: ${this.selectedChartType}, Data: ${this.selectedGraphType}`);
    this.closeGraphOverlay();
  }

  getSelectedData(): { [k: string]: number } {
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

  getGraphTitle(): string {
    switch (this.selectedGraphType) {
      case 'type':
        return 'Type';
      case 'shape':
        return 'Shape';
      case 'severity':
        return 'Severity';
      default:
        return 'Type';
    }
  }
}
