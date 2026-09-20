import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/auth_provider.dart';
import '../theme/app_theme.dart';
import 'connectivity_banner.dart';

class RoleNavItem {
  final IconData icon;
  final String label;
  final Widget Function(BuildContext context) builder;
  const RoleNavItem({required this.icon, required this.label, required this.builder});
}

/// Shared shell for every role portal — a drawer listing that role's
/// sections (mirrors the web app's sidebar), an app bar showing the
/// section title + a live/connected badge, and a body that swaps between
/// sections without losing the drawer. Each role's home screen supplies its
/// own [items]; this widget owns none of the navigation-list content
/// itself so adding/removing a section per role stays a one-line change in
/// that role's home screen file.
class RoleScaffold extends StatefulWidget {
  final String portalTitle;
  final List<RoleNavItem> items;
  final int initialIndex;

  const RoleScaffold({
    super.key,
    required this.portalTitle,
    required this.items,
    this.initialIndex = 0,
  });

  static RoleScaffoldState? of(BuildContext context) {
    return context.findAncestorStateOfType<RoleScaffoldState>();
  }

  @override
  State<RoleScaffold> createState() => RoleScaffoldState();
}

class RoleScaffoldState extends State<RoleScaffold> {
  late int _index = widget.initialIndex;

  int get currentIndex => _index;

  void setIndex(int index) {
    if (index >= 0 && index < widget.items.length) {
      setState(() => _index = index);
    }
  }

  bool navigateToLabel(String label) {
    final query = label.trim().toLowerCase();
    final idx = widget.items.indexWhere((it) => it.label.trim().toLowerCase() == query);
    if (idx != -1) {
      setState(() => _index = idx);
      return true;
    }
    final partialIdx = widget.items.indexWhere(
      (it) => it.label.trim().toLowerCase().contains(query) || query.contains(it.label.trim().toLowerCase()),
    );
    if (partialIdx != -1) {
      setState(() => _index = partialIdx);
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final current = widget.items[_index];
    final displayName = auth.user?.name.isNotEmpty == true ? auth.user!.name : 'Account';
    final initials = displayName.trim().isNotEmpty ? displayName.trim()[0].toUpperCase() : '?';

    return Scaffold(
      // COMPLETENESS FIX (brand consistency — "same to same as the website"): background/avatar
      // colors below match the web app's own PortalHeader (src/components/Sidebar.jsx) exactly —
      // bg-surface top bar, a primary-light/primary-dark initials avatar — rather than Material's
      // default white app bar with a generic "Live" badge that has no web equivalent.
      appBar: AppBar(
        title: Text(current.label),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.md),
            child: CircleAvatar(
              radius: 16,
              backgroundColor: AppColors.primaryLight,
              child: Text(
                initials,
                style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 13),
              ),
            ),
          ),
        ],
      ),
      drawer: Drawer(
        backgroundColor: AppColors.charcoal,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.all(Radius.circular(11)),
                      child: Image(image: AssetImage('assets/branding/app_icon.png'), width: 36, height: 36),
                    ),
                    SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        'BookMyDoctor24',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 17),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.sm),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(AppRadius.button),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.portalTitle, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                  itemCount: widget.items.length,
                  itemBuilder: (context, i) {
                    final item = widget.items[i];
                    final selected = i == _index;
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 1),
                      child: ListTile(
                        dense: true,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
                        leading: Icon(item.icon, size: 20, color: selected ? Colors.white : Colors.white.withValues(alpha: 0.75)),
                        title: Text(
                          item.label,
                          style: TextStyle(
                            color: selected ? Colors.white : Colors.white.withValues(alpha: 0.75),
                            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                            fontSize: 14,
                          ),
                        ),
                        selected: selected,
                        selectedTileColor: AppColors.primaryDark,
                        onTap: () {
                          setState(() => _index = i);
                          Navigator.of(context).pop();
                        },
                      ),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                child: ListTile(
                  dense: true,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
                  leading: Icon(Icons.logout, size: 20, color: Colors.white.withValues(alpha: 0.75)),
                  title: Text('Sign out', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 14)),
                  onTap: () async {
                    Navigator.of(context).pop();
                    await context.read<AuthProvider>().logout();
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
      // A single obvious top-level mount point for every role portal screen — see
      // widgets/connectivity_banner.dart's own doc comment for what it does and doesn't cover.
      body: Column(
        children: [
          const ConnectivityBanner(),
          Expanded(child: current.builder(context)),
        ],
      ),
    );
  }
}
