import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';

interface CrackStats {
  type: { [key: string]: number };
  severity: { [key: string]: number };
  shape: { [key: string]: number };
  totalCracks: number;
}

@Component({
  selector: 'app-results-page',
  templateUrl: './results-page.page.html',
  styleUrls: ['./results-page.page.scss'],
  standalone: false
})
export class ResultsPageComponent implements OnInit {
  sessionId: string | null = null;
  stats: CrackStats = {
    type: {},
    severity: {},
    shape: {},
    totalCracks: 0,
  };

  constructor(
    private imageStorage: ImageStorageService,
    private route: ActivatedRoute,
    private navCtrl: NavController
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      this.sessionId = params['sessionId'] || null;
      this.loadAndAnalyzeData();
    });
  }

  /**
   * Load images and aggregate crack statistics
   */
  loadAndAnalyzeData() {
    const allImages = this.imageStorage.getAllImages();

    // Filter by session if sessionId provided
    let imagesToAnalyze: StoredImage[] = allImages;

    if (this.sessionId) {
      const session = this.imageStorage.getSession(this.sessionId);
      if (session) {
        imagesToAnalyze = allImages.filter((img) =>
          session.imageKeys.includes(img.filename)
        );
      }
    }

    // Aggregate statistics
    this.aggregateStats(imagesToAnalyze);
  }

  /**
   * Aggregate crack statistics from images
   */
  private aggregateStats(images: StoredImage[]) {
    this.stats = {
      type: {},
      severity: {},
      shape: {},
      totalCracks: 0,
    };

    images.forEach((img) => {
      if (img.prediction) {
        const { type, severity, shape } = img.prediction;

        // Count by type
        if (type) {
          this.stats.type[type] = (this.stats.type[type] || 0) + 1;
        }

        // Count by severity
        if (severity) {
          this.stats.severity[severity] =
            (this.stats.severity[severity] || 0) + 1;
        }

        // Count by shape
        if (shape) {
          this.stats.shape[shape] = (this.stats.shape[shape] || 0) + 1;
        }

        this.stats.totalCracks++;
      }
    });
  }

  /**
   * Get display text for scope
   */
  getScopeText(): string {
    return this.sessionId ? 'Current Session' : 'All Sessions';
  }

  /**
   * Get max value from stats object for bar chart scaling
   */
  getMaxValue(statsObject: { [key: string]: number }): number {
    const values = Object.values(statsObject);
    return values.length > 0 ? Math.max(...values) : 1;
  }

  /**
   * Navigate back
   */
  goBack() {
    this.navCtrl.back();
  }
}
