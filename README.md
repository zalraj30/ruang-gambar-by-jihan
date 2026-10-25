# Ruang Gambar

Website papan gambar publik yang bisa dipakai banyak orang secara bersamaan. Goresan muncul secara real-time di browser pengunjung lain dan disimpan otomatis ke server.

## Fitur

- Menggambar pakai mouse, jari, atau stylus.
- Kuas, penghapus, warna preset, pemilih warna sendiri, dan pengaturan ukuran.
- Goresan muncul secara real-time bagi pengunjung lain.
- Gambar tersimpan otomatis di server dan dimuat lagi saat website dibuka.
- Jumlah pengunjung online dan jumlah goresan.
- Unduh hasil kanvas sebagai PNG.
- Layout responsif untuk HP dan komputer.

## Menjalankan di komputer sendiri

Butuh Node.js 22 atau lebih baru.

1. Ekstrak folder proyek.
2. Buka terminal di folder `ruang-gambar`.
3. Jalankan `npm install`.
4. Jalankan `npm start`.
5. Buka `http://localhost:3000`.

Untuk mengetes kolaborasi, buka alamat tersebut di dua tab browser. Keduanya berbagi papan yang sama.

## Memublikasikan ke internet (contoh: Render)

1. Unggah folder proyek ini ke repository GitHub.
2. Di Render, buat **New Web Service** dan hubungkan repository tersebut.
3. Isi **Build Command**: `npm install`
4. Isi **Start Command**: `npm start`
5. Gunakan runtime Node.js 22 atau lebih baru.
6. Agar karya tidak hilang saat service di-restart atau di-deploy ulang, tambahkan **Persistent Disk** pada Render, pasang di `/var/data`, lalu buat environment variable `DATA_DIR=/var/data`.
7. Deploy. Buka URL publik yang diberikan Render untuk mulai menggambar.

> Penyimpanan file bawaan cocok untuk pengembangan lokal. Pada hosting yang punya filesystem sementara, data bisa hilang ketika service di-restart/deploy jika persistent disk atau penyimpanan permanen lain tidak diaktifkan.

## Catatan papan publik

Saat ini siapa saja yang membuka URL dapat menggambar dan menghapus bagian gambar menggunakan alat penghapus. Tidak ada login, moderasi, atau tombol untuk mengosongkan seluruh papan. Jangan gunakan papan ini untuk data pribadi. Jika situs akan dipakai banyak orang, pertimbangkan menambahkan moderasi, pembatasan spam, dan sistem akun.
