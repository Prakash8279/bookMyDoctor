import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ThemePreference extends ChangeNotifier {
  ThemePreference({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  ThemeMode mode = ThemeMode.system;
  bool _changed = false;
  Future<void> load() async {
    try {
      final saved = await _storage.read(key: 'bookadoctors_appearance');
      if (_changed) return;
      mode = switch (saved) {
        'dark' => ThemeMode.dark,
        'light' => ThemeMode.light,
        _ => ThemeMode.system
      };
      notifyListeners();
    } catch (_) {/* Storage failure must not prevent opening the app. */}
  }

  Future<void> setMode(ThemeMode value) async {
    _changed = true;
    mode = value;
    notifyListeners();
    try {
      await _storage.write(key: 'bookadoctors_appearance', value: value.name);
    } catch (_) {}
  }
}

class ThemePreferenceButton extends StatelessWidget {
  const ThemePreferenceButton({super.key});
  @override
  Widget build(BuildContext context) {
    final preference = context
        .dependOnInheritedWidgetOfExactType<ThemePreferenceScope>()
        ?.notifier;
    if (preference == null) return const SizedBox.shrink();
    final dark = Theme.of(context).brightness == Brightness.dark;
    return IconButton(
      tooltip: dark ? 'Switch to light theme' : 'Switch to dark theme',
      icon: Icon(dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
      onPressed: () =>
          preference.setMode(dark ? ThemeMode.light : ThemeMode.dark),
    );
  }
}

class ThemePreferenceScope extends InheritedNotifier<ThemePreference> {
  const ThemePreferenceScope(
      {super.key, required ThemePreference preference, required super.child})
      : super(notifier: preference);
}

class ThemePreferenceCard extends StatelessWidget {
  const ThemePreferenceCard({super.key});
  @override
  Widget build(BuildContext context) {
    final preference = context
        .dependOnInheritedWidgetOfExactType<ThemePreferenceScope>()
        ?.notifier;
    if (preference == null) return const SizedBox.shrink();
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Align(
      alignment: Alignment.centerRight,
      child: TextButton.icon(
        icon: Icon(dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
        label: Text(dark ? 'Light theme' : 'Dark theme'),
        onPressed: () =>
            preference.setMode(dark ? ThemeMode.light : ThemeMode.dark),
      ),
    );
  }
}
