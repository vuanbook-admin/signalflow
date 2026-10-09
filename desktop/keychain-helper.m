#import <Foundation/Foundation.h>
#import <Security/Security.h>

static BOOL readLength(uint32_t *length) {
  uint8_t bytes[4];
  return fread(bytes, 1, sizeof(bytes), stdin) == sizeof(bytes)
    ? (*length = ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) | ((uint32_t)bytes[2] << 8) | bytes[3], YES)
    : NO;
}

static NSData *readData(void) {
  uint32_t length = 0;
  if (!readLength(&length) || length > 1000000) return nil;
  NSMutableData *data = [NSMutableData dataWithLength:length];
  return fread(data.mutableBytes, 1, length, stdin) == length ? data : nil;
}

static NSDictionary *queryForAccount(NSString *account) {
  return @{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
           (__bridge id)kSecAttrService: @"SignalFlow",
           (__bridge id)kSecAttrAccount: account};
}

static SecAccessRef openAccess(void) {
  SecAccessRef access = NULL;
  return SecAccessCreate(CFSTR("SignalFlow"), NULL, &access) == errSecSuccess ? access : NULL;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSData *accountData = readData();
    NSString *account = accountData ? [[NSString alloc] initWithData:accountData encoding:NSUTF8StringEncoding] : nil;
    if (!account.length) return 2;
    NSDictionary *query = queryForAccount(account);
    NSString *operation = [NSString stringWithUTF8String:argv[1]];

    if ([operation isEqualToString:@"get"]) {
      NSMutableDictionary *readQuery = [query mutableCopy];
      readQuery[(__bridge id)kSecReturnData] = @YES;
      readQuery[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
      CFTypeRef result = nil;
      OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)readQuery, &result);
      if (status == errSecItemNotFound) return 44;
      if (status != errSecSuccess) return 1;
      NSData *secret = CFBridgingRelease(result);
      return fwrite(secret.bytes, 1, secret.length, stdout) == secret.length ? 0 : 1;
    }

    if ([operation isEqualToString:@"set"]) {
      NSData *secret = readData();
      if (!secret) return 2;
      OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData: secret});
      if (status == errSecItemNotFound) {
        NSMutableDictionary *addQuery = [query mutableCopy];
        addQuery[(__bridge id)kSecValueData] = secret;
        status = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
      }
      return status == errSecSuccess ? 0 : 1;
    }

    if ([operation isEqualToString:@"grant-access"]) {
      SecAccessRef access = openAccess();
      if (!access) return 1;
      OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)@{(__bridge id)kSecAttrAccess: (__bridge id)access});
      CFRelease(access);
      return status == errSecSuccess ? 0 : status == errSecItemNotFound ? 44 : 1;
    }

    if ([operation isEqualToString:@"delete"]) {
      OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
      return status == errSecSuccess || status == errSecItemNotFound ? 0 : 1;
    }
  }
  return 2;
}
