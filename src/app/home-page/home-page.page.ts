import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';

@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.page.html',
  styleUrls: ['./home-page.page.scss'],
  standalone: false
})
export class HomePagePage implements OnInit {
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;

  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service) {

  }

//   ngOnInit() {
//     // Initialization logic can go here
//     const user = this.auth3.getCurrentUser();
   
//     // this.firstName = user?.firstName ?? null;
//     // this.lastName = user?.lastName ?? null;
// this.userName = user?.email ?? null;
//     try {
//       const profile = await this.auth3.getUserProfile();
//    this.firstName = profile['firstName'];
// this.lastName = profile['lastName'];

       
//     } catch (error) {
//       console.error(error);
//     }
  

//     // subscribe to auth changes (optional)
//     // this.authService.onAuthChange((u: User | null) => {
//     //   this.userName = u?.email ?? null;
//     //   if (!u) this.navCtrl.navigateRoot('/login');
//     // });
//   }

async ngOnInit() {
  try {
    const profile = await this.auth3.getUserProfile();
   this.firstName = profile['firstName'];
this.lastName = profile['lastName'];
  } catch (error) {
    console.error(error);
  }
}

  recommendedCourses = [
    {
      title: 'Morning textbook',
      rating: 8.6,
      favorited: true,
    },
    {
      title: 'English reading',
      rating: 8.0,
      favorited: false,
    },
    {
      title: 'Illustration',
      rating: 7.5,
      favorited: false,
    },
  ];

  goToHomePage() {
    this.router.navigate(['/camera-page']);
    console.log('camera page');
  }

  goTestCameraPage() {
    this.router.navigate(['/custom-camera-test']);
    console.log('custom camera');
  }

  gopdfPage() {
    this.router.navigate(['/pdf-page-test']);
    console.log('pdf page');
  }

  gopdfPage2() {
    this.router.navigate(['/pdf-page-test02']);
    console.log('pdf 2 page');
  }


  gopdfPage3() {
    this.router.navigate(['/pdf-page-test03']);
    console.log('pdf 3 page');
  }



  
  

  // Additional methods can be added here


}
