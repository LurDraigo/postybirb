import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Website } from '../../interfaces/website.interface';
import { BaseWebsite } from './base-website';
import { SupportedWebsites } from '../../enums/supported-websites';
import { WebsiteStatus } from '../../enums/website-status.enum';
import { HTMLParser } from '../../helpers/html-parser';
import { PostyBirbSubmissionData } from '../../interfaces/posty-birb-submission-data.interface';
import { Observable } from 'rxjs';


@Injectable()
export class FurryNetwork extends BaseWebsite implements Website {
  private userInformation: any;

  constructor(private http: HttpClient) {
    super(SupportedWebsites.FurryNetwork, 'https://beta.furrynetwork.com');

    this.userInformation = store.get(SupportedWebsites.FurryNetwork.toLowerCase()) || {
      name: null,
      token: null,
    };

    this.mapping = {
      rating: {
        General: 0,
        Mature: 1,
        Explicit: 2,
        Extreme: 2,
      },
      content: {
        Artwork: 'artwork',
        Story: 'story',
        Poetry: 0,
        Music: 'multimedia',
        Animation: 'multimedia',
      }
    };
  }

  getStatus(): Promise<WebsiteStatus> {
    return new Promise(resolve => {
      this.http.get(this.baseURL, { responseType: 'text' })
        .subscribe(page => {
          if (this.userInformation.name) {
            this.http.get(`${this.baseURL}/api/user`,
              { headers: new HttpHeaders().set('Authorization', `Bearer ${this.userInformation.token.access_token}`) })
              .subscribe(info => {
                this.otherInformation = info;
                this.loginStatus = WebsiteStatus.Logged_In;
                resolve(this.loginStatus);
              }, err => {
                this.loginStatus = WebsiteStatus.Logged_Out;
                resolve(this.loginStatus);
              });
          } else {
            this.loginStatus = WebsiteStatus.Logged_Out;
            resolve(this.loginStatus);
          }
        }, err => {
          this.loginStatus = WebsiteStatus.Offline;
          resolve(WebsiteStatus.Offline);
        });
    });
  }

  getLoginStatus(): WebsiteStatus {
    return this.loginStatus;
  }

  getUser(): Promise<string> {
    return new Promise((resolve, reject) => {
      resolve(this.userInformation.name || null);
    });
  }

  authorize(authInfo: any): Promise<any> {
    return new Promise((resolve, reject) => {

      const tokenRequestForm = new FormData();
      tokenRequestForm.set('username', authInfo.username);
      tokenRequestForm.set('password', authInfo.password);
      tokenRequestForm.set('grant_type', 'password');
      tokenRequestForm.set('client_id', '123');
      tokenRequestForm.set('client_secret', '');

      this.http.post(`${this.baseURL}/api/oauth/token`, tokenRequestForm)
        .subscribe(res => {
          this.userInformation.token = res;

          this.http.get(`${this.baseURL}/api/user`, { headers: new HttpHeaders().set('Authorization', `Bearer ${this.userInformation.token.access_token}`) })
            .subscribe((info: any) => {
              this.userInformation.name = info.characters[0].name
              store.set(SupportedWebsites.FurryNetwork.toLowerCase(), this.userInformation, new Date().setMonth(new Date().getMonth() + 2));
              resolve(true);
            }, err => reject(false));
        }, err => {
          reject(false);
        });
    });
  }

  unauthorize(): any {
    this.userInformation = {
      name: '',
      token: null,
    };

    this.loginStatus = WebsiteStatus.Logged_Out;
    store.remove(SupportedWebsites.FurryNetwork.toLowerCase());
  }

  refresh(): Promise<any> {
    return new Promise((resolve, reject) => {
      const storedToken = store.get(SupportedWebsites.FurryNetwork.toLowerCase());
      if (!storedToken.token) reject('No token');
      this.http.post(`${this.baseURL}/api/oauth/token`, `client_id=123&grant_type=refresh_token&refresh_token=${storedToken.token.refresh_token}`, { headers: new HttpHeaders().set('Content-Type', 'application/x-www-form-urlencoded') }).subscribe((res: any) => {
        this.userInformation = storedToken;
        this.userInformation.token.access_token = res.access_token;
        store.set(SupportedWebsites.FurryNetwork.toLowerCase(), this.userInformation, new Date().setMonth(new Date().getMonth() + 2));
        resolve(`Refreshed ${this.websiteName}`);
      }, err => {
        this.unauthorize();
        reject(`Unable to refresh ${this.websiteName}`);
      });
    });
  }

  public checkAuthorized(): Promise<boolean> {
    return this.refresh();
  }

  private generateUploadUrl(userProfile: string, file: File, type: any): string {
    let uploadURL = '';

    if (type === 'story') {
      uploadURL = `${this.baseURL}/api/story`;
    } else {
      uploadURL = `${this.baseURL}/api/submission/${userProfile}/${type}/upload?` +
        'resumableChunkNumber=1' +
        '&resumableChunkSize=1048576' + `&resumableCurrentChunkSize=${file.size
        }&resumableTotalSize=${file.size
        }&resumableType=${file.type
        }&resumableIdentifier=${file.size}-${file.name.replace('.', '')
        }&resumableFilename=${file.name
        }&resumableRelativePath=${file.name
        }&resumableTotalChunks=1`;
    }

    return uploadURL;
  }

  private generatePostData(submission: PostyBirbSubmissionData, type: any): object {
    if (type === 'story') {
      return {
        collections: [],
        description: submission.description || submission.submissionData.title,
        status: submission.options.status,
        title: submission.submissionData.title,
        tags: this.formatTags(submission.defaultTags, submission.customTags),
        rating: this.getMapping('rating', submission.submissionData.submissionRating),
        community_tags_allowed: submission.options.communityTags,
        content: submission.submissionData.submissionFile.getFileBuffer().toString('utf-8')
      };
    } else {
      return {
        collections: [],
        description: submission.description,
        status: submission.options.status,
        title: submission.submissionData.title,
        tags: this.formatTags(submission.defaultTags, submission.customTags),
        rating: this.getMapping('rating', submission.submissionData.submissionRating),
        community_tags_allowed: submission.options.communityTags,
        publish: submission.options.notify,
      };
    }
  }

  post(submission: PostyBirbSubmissionData): Observable<any> {
    return new Observable(observer => {
      const userProfile = submission.options.profile || this.userInformation.name;
      let type = this.getMapping('content', submission.submissionData.submissionType);
      const file = submission.submissionData.submissionFile.getRealFile();
      const headers: HttpHeaders = new HttpHeaders().set('Authorization', `Bearer ${this.userInformation.token.access_token}`);

      if (file.type === 'image/gif') type = 'multimedia';
      let uploadURL = this.generateUploadUrl(userProfile, file, type);

      if (type === 'story') {
        this.http.post(uploadURL, JSON.stringify(this.generatePostData(submission, type)), { headers: headers })
          .subscribe(res => {
            observer.next(res);
            observer.complete();
          }, err => {
            observer.error(this.createError(err, submission));
            observer.complete();
          });
      } else {
        this.http.post(uploadURL, file, { headers: headers })
          .subscribe((fileInfo: any) => {
            this.http.patch(`${this.baseURL}/api/${type}/${fileInfo.id}`, this.generatePostData(submission, type), { headers: headers })
              .subscribe(res => {
                observer.next(res);
                observer.complete();

                if (type === 'multimedia' && submission.submissionData.thumbnailFile.isValid()) {
                  const thumbnailFile = submission.submissionData.thumbnailFile.getRealFile();
                  const thumbnailURL = `${this.baseURL}/api/submission/${userProfile}/${type}/${fileInfo.id}/thumbnail?` +
                    'resumableChunkNumber=1' +
                    '&resumableChunkSize=1048576' + `&resumableCurrentChunkSize=${thumbnailFile.size}
                    &resumableTotalSize=${thumbnailFile.size}
                    &resumableType=${thumbnailFile.type}
                    &resumableIdentifier=${thumbnailFile.size}-${thumbnailFile.name.replace('.', '')}
                    &resumableFilename=${thumbnailFile.name}&resumableRelativePath=${thumbnailFile.name}
                    &resumableTotalChunks=1`;

                  this.http.post(thumbnailURL, thumbnailFile, { headers: headers })
                    .subscribe(success => {
                      //NOTHING TO DO
                    }, err => {
                      //NOTHING TO DO
                    });
                }
              });
          }, err => {
            observer.error(this.createError(err, submission));
            observer.complete();
          });
      }
    });
  }

  postJournal(title: string, description: string, options: any): Observable<any> {
    return new Observable(observer => {
      const data = {
        community_tags_allowed: false,
        collections: [],
        content: description,
        description: description.split('.')[0],
        rating: this.getMapping('rating', options.rating),
        title,
        subtitle: null,
        tags: this.formatTags(options.tags),
        status: 'public'
      };

      this.http.post(`${this.baseURL}/api/journal`, data, { headers: new HttpHeaders().set('Authorization', `Bearer ${this.userInformation.token.access_token}`) })
        .subscribe(res => {
          observer.next(true);
          observer.complete();
        }, err => {
          observer.error(this.createError(err, { title, description, options }));
          observer.complete();
        });
    });
  }

  formatTags(defaultTags: string[] = [], other: string[] = []): any {
    return super.formatTags(defaultTags, other, '-').map(tag => { return tag.replace(/(\(|\))/g, '') }).slice(0, 30);
  }
}