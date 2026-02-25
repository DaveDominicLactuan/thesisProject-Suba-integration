import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'networkPage'
})
export class NetworkPagePipe implements PipeTransform {

  transform(value: unknown, ...args: unknown[]): unknown {
    return null;
  }

}
