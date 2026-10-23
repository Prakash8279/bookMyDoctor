import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('state callbacks do not return assigned Futures', () {
    final invalid = RegExp(r'setState\(\(\)\s*=>\s*_(?:future|\w*Future)\s*=');
    for (final file in Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((file) => file.path.endsWith('.dart'))) {
      expect(invalid.hasMatch(file.readAsStringSync()), isFalse,
          reason: '${file.path} must use a synchronous block callback');
    }
  });
}
