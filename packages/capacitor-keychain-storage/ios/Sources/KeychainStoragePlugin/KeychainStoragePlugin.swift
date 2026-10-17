import Foundation
import Security
import Capacitor

/// Key/value store for the Supabase auth session, backed by the iOS Keychain (generic passwords).
///
/// Security properties, all deliberate:
/// - Values are only ever written to / read from the Keychain; nothing is logged and no value appears in an error message.
/// - `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: readable after the first unlock (a token refresh can happen after the
///   device re-locks) but never migrated to another device through a backup or restore.
/// - The Keychain outlives an app uninstall on iOS, UserDefaults does not. A marker in UserDefaults therefore detects a fresh
///   install, and any Keychain items left by a previous install are purged before JS can read them (otherwise deleting the app
///   would not sign the user out).
@objc(KeychainStoragePlugin)
public class KeychainStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeychainStoragePlugin"
    public let jsName = "KeychainStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private static let service = "com.racehorse.dominoes.auth"
    private static let installMarker = "com.racehorse.dominoes.keychainInstallMarker"

    override public func load() {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: Self.installMarker) {
            SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Self.service
            ] as CFDictionary)
            defaults.set(true, forKey: Self.installMarker)
        }
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: key
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Must provide a key") }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
                return call.reject("Keychain value unreadable")
            }
            call.resolve(["value": value])
        case errSecItemNotFound:
            call.resolve(["value": NSNull()])
        default:
            call.reject("Keychain read failed (\(status))")
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Must provide a key") }
        guard let value = call.getString("value"), let data = value.data(using: .utf8) else {
            return call.reject("Must provide a value")
        }
        let updateStatus = SecItemUpdate(baseQuery(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updateStatus == errSecSuccess { return call.resolve() }
        guard updateStatus == errSecItemNotFound else { return call.reject("Keychain write failed (\(updateStatus))") }
        var add = baseQuery(key)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus == errSecSuccess { call.resolve() } else { call.reject("Keychain write failed (\(addStatus))") }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Must provide a key") }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("Keychain delete failed (\(status))") }
    }
}
