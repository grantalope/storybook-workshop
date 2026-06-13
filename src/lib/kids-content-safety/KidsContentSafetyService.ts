// Kids content safety service stub
export class KidsContentSafetyService {
  check(content: string): Promise<{ isOk: boolean }> {
    return Promise.resolve({ isOk: true });
  }
}
