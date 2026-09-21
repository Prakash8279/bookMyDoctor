import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Every /family-members route is hard-scoped server-side to the caller's
/// own id (integration_plan.md §1.6) — no patientUserId field exists on
/// this resource at all, so there's nothing to guard against cross-patient
/// leakage on the client side either.
class FamilyMembersScreen extends StatefulWidget {
  const FamilyMembersScreen({super.key});

  @override
  State<FamilyMembersScreen> createState() => _FamilyMembersScreenState();
}

class _FamilyMembersScreenState extends State<FamilyMembersScreen> {
  Future<List<FamilyMember>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<FamilyMember>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/family-members', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: []));
      final list = <FamilyMember>[];
      for (final item in res.list) {
        try {
          list.add(FamilyMember.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<void> _openForm({FamilyMember? existing}) async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _FamilyMemberForm(existing: existing),
    );
    if (result == true) _load();
  }

  Future<void> _delete(FamilyMember member) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Remove ${member.name}?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await ApiClient.instance.delete('/family-members/${member.id}');
      if (mounted) {
        showSuccessSnack(context, 'Removed');
        _load();
      }
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  // COMPLETENESS FIX (mobile parity audit, patient panel): web's "Export CSV" action
  // (PatientPages.jsx Family#exportCsv) had no mobile equivalent. Same header/column order/values.
  Future<void> _exportCsv(List<FamilyMember> members) async {
    await shareCsv(
      filename: 'family-members.csv',
      headers: const ['ID', 'Full name', 'Relationship', 'Date of birth', 'Gender', 'Blood group', 'Age'],
      rows: [
        for (var i = 0; i < members.length; i++)
          [
            'DC${(i + 1).toString().padLeft(2, '0')}',
            members[i].name,
            members[i].relation,
            members[i].dateOfBirth ?? '',
            members[i].gender ?? '',
            members[i].bloodGroup ?? '',
            members[i].age ?? '',
          ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openForm(),
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Family members',
              subtitle: 'Manage dependents for appointment booking.',
              // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action — see _exportCsv.
              action: FutureBuilder<List<FamilyMember>>(
                future: _future,
                builder: (context, snapshot) {
                  final members = snapshot.data ?? const <FamilyMember>[];
                  return TextButton.icon(
                    onPressed: members.isEmpty ? null : () => _exportCsv(members),
                    icon: const Icon(Icons.file_download_outlined, size: 16),
                    label: const Text('Export CSV'),
                  );
                },
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<FamilyMember>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final members = snapshot.data ?? [];
                // COMPLETENESS FIX (mobile parity audit — Patient panel): no pull-to-refresh
                // existed on this screen at all — every other patient list screen (appointments,
                // payments, notifications) already wraps its list in a RefreshIndicator.
                if (members.isEmpty) {
                  return RefreshIndicator(
                    onRefresh: () async => _load(),
                    child: ListView(
                      children: const [
                        SizedBox(height: 80),
                        EmptyStateView(
                          icon: Icons.family_restroom,
                          title: 'No family members added',
                          subtitle: 'Add a family member to book appointments on their behalf',
                        ),
                      ],
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: members.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final m = members[i];
                      return Card(
                        child: ListTile(
                          title: Text(m.name),
                          subtitle: Text('${m.relation}${m.age != null ? " · ${m.age} yrs" : ""}${m.bloodGroup != null ? " · ${m.bloodGroup}" : ""}'),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () => _openForm(existing: m)),
                              IconButton(icon: const Icon(Icons.delete_outline, color: AppColors.danger), onPressed: () => _delete(m)),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _FamilyMemberForm extends StatefulWidget {
  final FamilyMember? existing;
  const _FamilyMemberForm({this.existing});

  @override
  State<_FamilyMemberForm> createState() => _FamilyMemberFormState();
}

class _FamilyMemberFormState extends State<_FamilyMemberForm> {
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _relationController = TextEditingController(text: widget.existing?.relation ?? '');
  String? _gender;
  String? _bloodGroup;
  DateTime? _dateOfBirth;
  bool _submitting = false;
  String? _error;

  static const _genderOptions = ['Female', 'Male', 'Other', 'Prefer not to say'];

  @override
  void initState() {
    super.initState();
    // Defensive normalization: a record saved before this fix may still carry the old lowercase
    // values ('male'/'female'/'other') — match case-insensitively so editing it doesn't crash on
    // DropdownButtonFormField's "exactly one matching item" assertion, and fall back to no
    // selection (rather than an unmatched value) if it still doesn't match any current option.
    final existingGender = widget.existing?.gender;
    if (existingGender != null) {
      for (final option in _genderOptions) {
        if (option.toLowerCase() == existingGender.toLowerCase()) {
          _gender = option;
          break;
        }
      }
    }
    _bloodGroup = widget.existing?.bloodGroup;
    if (widget.existing?.dateOfBirth != null) {
      _dateOfBirth = DateTime.tryParse(widget.existing!.dateOfBirth!);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _relationController.dispose();
    super.dispose();
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateOfBirth ?? DateTime(now.year - 20),
      firstDate: DateTime(1900),
      lastDate: now,
    );
    if (picked != null) setState(() => _dateOfBirth = picked);
  }

  Future<void> _submit() async {
    if (_nameController.text.trim().isEmpty || _relationController.text.trim().isEmpty) {
      setState(() => _error = 'Name and relation are required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final body = {
      'name': _nameController.text.trim(),
      'relation': _relationController.text.trim(),
      if (_dateOfBirth != null) 'dateOfBirth': DateFormat('yyyy-MM-dd').format(_dateOfBirth!),
      if (_gender != null) 'gender': _gender,
      if (_bloodGroup != null) 'bloodGroup': _bloodGroup,
    };
    try {
      if (widget.existing == null) {
        await ApiClient.instance.post('/family-members', body: body);
      } else {
        await ApiClient.instance.patch('/family-members/${widget.existing!.id}', body: body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.existing == null ? 'Add family member' : 'Edit family member',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _relationController, decoration: const InputDecoration(labelText: 'Relation (e.g. Son, Mother)')),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: _pickDob,
            icon: const Icon(Icons.cake_outlined, size: 18),
            label: Text(_dateOfBirth == null ? 'Date of birth (optional)' : DateFormat('dd MMM yyyy').format(_dateOfBirth!)),
          ),
          const SizedBox(height: AppSpacing.md),
          // PARITY FIX (mobile parity audit — Patient panel): web's Family form
          // (PatientPages.jsx) offers exactly ['Female', 'Male', 'Other', 'Prefer not to say'],
          // title-cased and sent verbatim as the `gender` value — mobile previously only offered
          // three lowercase options with no "Prefer not to say" choice.
          DropdownButtonFormField<String>(
            initialValue: _gender,
            decoration: const InputDecoration(labelText: 'Gender (optional)'),
            items: [
              for (final option in _genderOptions) DropdownMenuItem(value: option, child: Text(option)),
            ],
            onChanged: (v) => setState(() => _gender = v),
          ),
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<String>(
            initialValue: _bloodGroup,
            decoration: const InputDecoration(labelText: 'Blood group (optional)'),
            items: const [
              DropdownMenuItem(value: 'A+', child: Text('A+')),
              DropdownMenuItem(value: 'A-', child: Text('A-')),
              DropdownMenuItem(value: 'B+', child: Text('B+')),
              DropdownMenuItem(value: 'B-', child: Text('B-')),
              DropdownMenuItem(value: 'AB+', child: Text('AB+')),
              DropdownMenuItem(value: 'AB-', child: Text('AB-')),
              DropdownMenuItem(value: 'O+', child: Text('O+')),
              DropdownMenuItem(value: 'O-', child: Text('O-')),
            ],
            onChanged: (v) => setState(() => _bloodGroup = v),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Save', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
